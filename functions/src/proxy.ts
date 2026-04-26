/**
 * Admin-authenticated HTTP proxy to the sidecar. Keeps the sidecar API
 * key server-side so it never ships to the browser.
 *
 * Client calls `GET/POST/PUT/DELETE /sidecarProxy?path=/<sidecar-path>`
 * with `Authorization: Bearer <firebase-id-token>`. We verify the Firebase
 * token, load the caller's role, enforce the admin-vs-patient path
 * allow-list, and forward to the sidecar with the server-side API key.
 *
 * SSE (`/chat`) is piped through byte-for-byte so streaming stays streaming.
 */

import {onRequest} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {corsOptions} from "./lib/cors.js";
import {
  SIDECAR_URL_SECRET,
  SIDECAR_API_KEY_SECRET,
  sidecarUrlEnv,
  sidecarApiKeyEnv,
} from "./lib/sidecar.js";
import {isSuperAdminEmail} from "./superAdmins.js";
import {INCLUDE_SIM_MODE} from "./lib/sim-flag.js";

export const sidecarProxy = onRequest({
  cors: corsOptions,
  timeoutSeconds: 120,
  memory: "512MiB",
  secrets: [SIDECAR_URL_SECRET, SIDECAR_API_KEY_SECRET],
}, async (req, res) => {
  try {
    // Verify Firebase auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({error: "Unauthorized"});
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
    } catch {
      res.status(401).json({error: "Invalid token"});
      return;
    }

    const db = admin.firestore();

    // Super admin: identified by email, no Firestore doc — treat as admin.
    let userRole: string;
    let userData: admin.firestore.DocumentData;
    if (isSuperAdminEmail(decodedToken.email)) {
      userRole = "admin";
      userData = {role: "admin", firstName: "Super", lastName: "Admin", email: decodedToken.email};
    } else {
      let userDoc = await db.collection("users").doc(decodedToken.uid).get();
      // Sim-mode fallback: when an operator impersonates a seeded demo
      // patient, their UID only exists at `simulation/native/users/<uid>`.
      // AuthContext already mirrors this fallback on the web side so the
      // banner + dashboard render; without the same fallback here, the
      // proxy rejects every sidecar call (including support chat) with
      // 403 "User not found".
      if (!userDoc.exists && INCLUDE_SIM_MODE) {
        const settings = await db.doc("system/settings").get();
        const simMode = settings.exists && settings.data()?.simulationMode === true;
        if (simMode) {
          userDoc = await db.doc(`simulation/native/users/${decodedToken.uid}`).get();
        }
      }
      if (!userDoc.exists) {
        res.status(403).json({error: "User not found"});
        return;
      }
      userData = userDoc.data()!;
      userRole = userData.role as string;
      const isActive = userData.isActive !== false;
      if (!isActive) {
        res.status(403).json({error: "Account is inactive"});
        return;
      }
    }

    // Non-admins (patients) can only access /chat and /healthz.
    // Admin-scoped paths require role === 'admin'.
    const sidecarPath = (req.query.path as string) || "/healthz";
    const nonAdminAllowed = ["/chat", "/healthz"];
    if (userRole !== "admin" && !nonAdminAllowed.includes(sidecarPath)) {
      res.status(403).json({error: "Access denied"});
      return;
    }

    // Special case: /slack/auth-test — handled locally, NOT forwarded to the
    // sidecar. Slack's Web API rejects browser preflight requests that carry
    // an Authorization header, so the browser cannot call auth.test directly.
    // We proxy it here (admin-only) where there is no CORS restriction.
    if (sidecarPath === "/slack/auth-test") {
      if (userRole !== "admin") {
        res.status(403).json({error: "Admin access required"});
        return;
      }
      const botToken = (req.body as { botToken?: string })?.botToken;
      if (!botToken || typeof botToken !== "string") {
        res.status(400).json({error: "botToken required"});
        return;
      }
      try {
        const slackRes = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: {Authorization: `Bearer ${botToken}`},
        });
        const data = (await slackRes.json()) as {
          ok: boolean;
          team?: string;
          team_id?: string;
          error?: string;
        };
        res.status(200).json(data);
      } catch (err: any) {
        logger.error("slack auth.test failed:", {message: err.message});
        res.status(502).json({error: `Could not reach Slack: ${err.message}`});
      }
      return;
    }

    const sidecarUrl = sidecarUrlEnv();
    const sidecarApiKey = sidecarApiKeyEnv();
    if (!sidecarApiKey) {
      res.status(503).json({error: "Sidecar not configured"});
      return;
    }

    const userName = `${userData.firstName || ""} ${userData.lastName || ""}`.trim() || "Unknown";

    // Tell the sidecar we want SSE for /chat. Other endpoints are JSON.
    const wantsStream = sidecarPath === "/chat";

    const sidecarRes = await fetch(`${sidecarUrl}${sidecarPath}`, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        ...(wantsStream ? {Accept: "text/event-stream"} : {}),
        "Authorization": `Bearer ${sidecarApiKey}`,
        "X-User-Uid": decodedToken.uid,
        "X-User-Role": userRole,
        "X-User-Name": userName,
      },
      body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
    });

    const contentType = sidecarRes.headers.get("content-type") || "";

    // SSE pass-through — pipe upstream chunks straight to the client. Cloud
    // Run supports streaming responses; we must flush headers before write
    // so the browser gets the first chunk without buffering the whole reply.
    if (contentType.includes("text/event-stream") && sidecarRes.body) {
      res.status(sidecarRes.status);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      const reader = sidecarRes.body.getReader();
      try {
        for (;;) {
          const {value, done} = await reader.read();
          if (done) break;
          if (value) {
            res.write(Buffer.from(value));
            // Encourage immediate flush; node defaults to Nagle-ish buffering.
            (res as any).flush?.();
          }
        }
      } finally {
        res.end();
      }
      return;
    }

    if (contentType.includes("application/json")) {
      const data = await sidecarRes.json();
      res.status(sidecarRes.status).json(data);
    } else {
      const text = await sidecarRes.text();
      res.status(sidecarRes.status).send(text);
    }
  } catch (error: any) {
    logger.error("Sidecar proxy error:", {
      message: error.message,
      code: error.code,
      cause: error.cause?.message,
      stack: error.stack?.slice(0, 200),
      sidecarUrl: sidecarUrlEnv(),
    });
    res.status(502).json({error: `Sidecar unreachable: ${error.message}`});
  }
});

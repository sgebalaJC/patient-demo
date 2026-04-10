import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// Client for the patient support chat via sidecarProxy Cloud Function.
/// Uses the same unified auth flow as the web client — Firebase ID token
/// is verified by the Cloud Function, which passes user context to the sidecar.
class SupportChatService {
  static const String _proxyUrl =
      'https://us-central1-YOUR_FIREBASE_PROJECT.cloudfunctions.net/sidecarProxy';

  /// Send a message to the support agent and get a response.
  /// Optionally include [attachments] as base64-encoded files.
  Future<String> chat(
    String message, {
    List<Map<String, String>>? attachments,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw Exception('Not authenticated');

    final idToken = await user.getIdToken();

    final uri = Uri.parse('$_proxyUrl?path=/chat');
    final body = <String, dynamic>{
      'messages': [
        {'role': 'user', 'content': message},
      ],
    };

    if (attachments != null && attachments.isNotEmpty) {
      body['attachments'] = attachments;
    }

    final response = await http.post(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $idToken',
      },
      body: jsonEncode(body),
    );

    if (response.statusCode == 401 || response.statusCode == 403) {
      throw Exception('Authentication failed');
    }

    if (response.statusCode != 200) {
      throw Exception('Server error (${response.statusCode})');
    }

    final data = jsonDecode(response.body) as Map<String, dynamic>;
    return (data['content'] as String?) ?? '';
  }
}

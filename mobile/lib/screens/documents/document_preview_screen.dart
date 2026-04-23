import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/colors.dart';
import '../../models/document.dart';

class DocumentPreviewScreen extends StatefulWidget {
  final PatientDocument document;

  const DocumentPreviewScreen({super.key, required this.document});

  @override
  State<DocumentPreviewScreen> createState() => _DocumentPreviewScreenState();
}

class _DocumentPreviewScreenState extends State<DocumentPreviewScreen> {
  int _rotationTurns = 0;

  bool get _isImage {
    final t = widget.document.fileType ?? '';
    return t.startsWith('image/');
  }

  bool get _isPdf => (widget.document.fileType ?? '') == 'application/pdf';

  Future<void> _openExternal() async {
    final uri = Uri.tryParse(widget.document.fileUrl);
    if (uri == null) return;
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open file')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final doc = widget.document;
    final title = doc.originalFileName ?? doc.fileName;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black.withValues(alpha: 0.6),
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          title,
          style: const TextStyle(fontSize: 16),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (_isImage)
            IconButton(
              tooltip: 'Rotate',
              icon: const Icon(Icons.rotate_right),
              onPressed: () => setState(() => _rotationTurns = (_rotationTurns + 1) % 4),
            ),
          IconButton(
            tooltip: 'Open externally',
            icon: const Icon(Icons.open_in_new),
            onPressed: _openExternal,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_isImage) {
      return InteractiveViewer(
        minScale: 1,
        maxScale: 5,
        child: Center(
          child: RotatedBox(
            quarterTurns: _rotationTurns,
            child: Image.network(
              widget.document.fileUrl,
              fit: BoxFit.contain,
              loadingBuilder: (context, child, progress) {
                if (progress == null) return child;
                return const Center(
                  child: CircularProgressIndicator(color: Colors.white),
                );
              },
              errorBuilder: (context, error, stack) => _errorState(
                'Could not load image',
              ),
            ),
          ),
        ),
      );
    }

    if (_isPdf) {
      return _unsupportedState(
        icon: Icons.picture_as_pdf_outlined,
        label: 'PDF preview opens in your default viewer',
      );
    }

    return _unsupportedState(
      icon: Icons.insert_drive_file_outlined,
      label: 'Preview not available for this file type',
    );
  }

  Widget _unsupportedState({required IconData icon, required String label}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 72, color: Colors.white.withValues(alpha: 0.6)),
            const SizedBox(height: 16),
            Text(
              label,
              style: const TextStyle(color: Colors.white, fontSize: 15),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: _openExternal,
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open in external app'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _errorState(String label) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, size: 48, color: Colors.white70),
          const SizedBox(height: 12),
          Text(label, style: const TextStyle(color: Colors.white)),
        ],
      ),
    );
  }
}

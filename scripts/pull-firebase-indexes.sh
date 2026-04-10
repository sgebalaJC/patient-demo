# Navigate to project root (assuming script is in scripts/ folder)
cd "$(dirname "$0")/.."

firebase firestore:indexes > firestore.indexes.json
#!/bin/sh
set -e

VERSION="${1:-1.0.0}"
PLUGIN_NAME="jellyfin-plugin-subtitle-generator"
BUILD_DIR="Jellyfin.Plugin.SubtitleGenerator/bin/Release/net9.0"
PACKAGE_DIR="dist/$PLUGIN_NAME"
ZIP_NAME="${PLUGIN_NAME}_${VERSION}.zip"

echo "Building version $VERSION..."

# Clean and build
rm -rf Jellyfin.Plugin.SubtitleGenerator/bin Jellyfin.Plugin.SubtitleGenerator/obj

docker run --rm \
  -v "$(pwd):/workspace" \
  -w /workspace/Jellyfin.Plugin.SubtitleGenerator \
  mcr.microsoft.com/dotnet/sdk:9.0 \
  dotnet build --configuration Release

# Package
rm -rf "$PACKAGE_DIR" dist/*.zip
mkdir -p "$PACKAGE_DIR"
cp "$BUILD_DIR/Jellyfin.Plugin.SubtitleGenerator.dll" "$PACKAGE_DIR/"
cp meta.json "$PACKAGE_DIR/"

cd dist
zip -r "$ZIP_NAME" "$(basename "$PACKAGE_DIR")"

echo ""
echo "✅ Packaged: dist/$ZIP_NAME"
echo ""

# Show instructions
cat <<EOF
--- Next Steps ---

1. Create a GitHub release and upload dist/$ZIP_NAME
2. Update plugins.json with the release URL
3. Host plugins.json (e.g. via GitHub Pages at https://youruser.github.io/jellyfin-plugin-subtitle-generator/plugins.json)
4. Add that URL to Jellyfin:
   Dashboard > Plugins > Repositories > (+) Add Repository
   Name: Subtitle Generator
   URL:  https://youruser.github.io/jellyfin-plugin-subtitle-generator/plugins.json

Then Jellyfin will auto-install the plugin from the repository.
EOF

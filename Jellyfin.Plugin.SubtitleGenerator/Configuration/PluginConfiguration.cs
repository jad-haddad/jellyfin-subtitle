using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.SubtitleGenerator.Configuration
{
    public class PluginConfiguration : BasePluginConfiguration
    {
        public string ServiceUrl { get; set; } = "http://subtitle-generator";

        public int MaxCharsPerLine { get; set; } = 42;

        public int PollingIntervalSeconds { get; set; } = 5;
    }
}

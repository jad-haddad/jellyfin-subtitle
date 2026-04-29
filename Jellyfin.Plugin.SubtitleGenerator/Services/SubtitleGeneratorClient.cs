using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.SubtitleGenerator.Services
{
    public class SubtitleGeneratorClient
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly ILogger<SubtitleGeneratorClient> _logger;

        public SubtitleGeneratorClient(IHttpClientFactory httpClientFactory, ILogger<SubtitleGeneratorClient> logger)
        {
            _httpClientFactory = httpClientFactory;
            _logger = logger;
        }

        public string ServiceUrl => Plugin.Instance?.Configuration.ServiceUrl ?? "http://subtitle-generator";

        public int MaxCharsPerLine => Plugin.Instance?.Configuration.MaxCharsPerLine ?? 42;

        public async Task<SubmitJobResult> SubmitJobAsync(string filePath, string language, CancellationToken cancellationToken)
        {
            using var client = _httpClientFactory.CreateClient();
            client.BaseAddress = new Uri(ServiceUrl);

            var requestBody = new
            {
                path = filePath,
                language = language,
                max_chars_per_line = MaxCharsPerLine
            };

            var response = await client.PostAsJsonAsync("/jobs/from-path", requestBody, cancellationToken).ConfigureAwait(false);

            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                return new SubmitJobResult { AlreadyExists = true, Success = true };
            }

            if (response.StatusCode == HttpStatusCode.Accepted)
            {
                string? jobId = null;

                var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                if (!string.IsNullOrEmpty(content))
                {
                    try
                    {
                        var doc = JsonDocument.Parse(content);
                        if (doc.RootElement.TryGetProperty("job_id", out var jobIdProp))
                        {
                            jobId = jobIdProp.GetString();
                        }
                    }
                    catch { }
                }

                if (string.IsNullOrEmpty(jobId) && response.Headers.Location != null)
                {
                    var location = response.Headers.Location.ToString();
                    var lastSlash = location.LastIndexOf('/');
                    if (lastSlash >= 0)
                    {
                        jobId = location.Substring(lastSlash + 1);
                    }
                }

                return new SubmitJobResult { JobId = jobId, Success = true };
            }

            var errorContent = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            return new SubmitJobResult { Success = false, ErrorMessage = $"{response.StatusCode}: {errorContent}" };
        }

        public async Task<JobStatusResult?> GetJobStatusAsync(string jobId, CancellationToken cancellationToken)
        {
            using var client = _httpClientFactory.CreateClient();
            client.BaseAddress = new Uri(ServiceUrl);

            var response = await client.GetAsync($"/jobs/{jobId}", cancellationToken).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var content = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (string.IsNullOrEmpty(content))
            {
                return null;
            }

            try
            {
                var doc = JsonDocument.Parse(content);
                var root = doc.RootElement;

                return new JobStatusResult
                {
                    JobId = GetString(root, "job_id"),
                    Status = GetString(root, "status"),
                    ProgressPct = GetInt(root, "progress_pct"),
                    Filename = GetString(root, "filename"),
                    Language = GetString(root, "language"),
                    Error = GetString(root, "error")
                };
            }
            catch
            {
                return null;
            }
        }

        private static string? GetString(JsonElement element, string propertyName)
        {
            if (element.TryGetProperty(propertyName, out var prop) && prop.ValueKind == JsonValueKind.String)
            {
                return prop.GetString();
            }
            return null;
        }

        private static int GetInt(JsonElement element, string propertyName)
        {
            if (element.TryGetProperty(propertyName, out var prop) && prop.ValueKind == JsonValueKind.Number)
            {
                return prop.GetInt32();
            }
            return 0;
        }
    }

    public class SubmitJobResult
    {
        public bool Success { get; set; }
        public bool AlreadyExists { get; set; }
        public string? JobId { get; set; }
        public string? ErrorMessage { get; set; }
    }

    public class JobStatusResult
    {
        public string? JobId { get; set; }
        public string? Status { get; set; }
        public int ProgressPct { get; set; }
        public string? Filename { get; set; }
        public string? Language { get; set; }
        public string? Error { get; set; }
    }
}

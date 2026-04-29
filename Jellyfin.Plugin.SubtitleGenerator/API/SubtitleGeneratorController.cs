using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Jellyfin.Plugin.SubtitleGenerator.Services;

namespace Jellyfin.Plugin.SubtitleGenerator.API
{
    [Route("SubtitleGenerator")]
    [ApiController]
    public class SubtitleGeneratorController : ControllerBase
    {
        private readonly SubtitleGeneratorClient _client;
        private readonly ILibraryManager _libraryManager;
        private readonly ILibraryMonitor _libraryMonitor;
        private readonly ILogger<SubtitleGeneratorController> _logger;

        public SubtitleGeneratorController(
            SubtitleGeneratorClient client,
            ILibraryManager libraryManager,
            ILibraryMonitor libraryMonitor,
            ILogger<SubtitleGeneratorController> logger)
        {
            _client = client;
            _libraryManager = libraryManager;
            _libraryMonitor = libraryMonitor;
            _logger = logger;
        }

        [HttpGet("Script")]
        public IActionResult GetScript()
        {
            var assembly = typeof(Plugin).Assembly;
            using var stream = assembly.GetManifestResourceStream($"{typeof(Plugin).Namespace}.Web.Resources.subtitle-generator.js");
            if (stream == null)
            {
                return NotFound();
            }

            using var reader = new StreamReader(stream);
            var content = reader.ReadToEnd();
            return Content(content, "application/javascript");
        }

        [HttpGet("Styles")]
        public IActionResult GetStyles()
        {
            var assembly = typeof(Plugin).Assembly;
            using var stream = assembly.GetManifestResourceStream($"{typeof(Plugin).Namespace}.Web.Resources.subtitle-generator.css");
            if (stream == null)
            {
                return NotFound();
            }

            using var reader = new StreamReader(stream);
            var content = reader.ReadToEnd();
            return Content(content, "text/css");
        }

        [HttpGet("Config")]
        public IActionResult GetConfig()
        {
            var config = Plugin.Instance?.Configuration;
            if (config == null)
            {
                return NotFound();
            }

            return Ok(new
            {
                config.ServiceUrl,
                config.MaxCharsPerLine,
                config.PollingIntervalSeconds
            });
        }

        [HttpPost("Jobs")]
        public async Task<IActionResult> SubmitJob([FromBody] SubmitJobRequest request)
        {
            if (string.IsNullOrEmpty(request.ItemId) || string.IsNullOrEmpty(request.Language))
            {
                return BadRequest("ItemId and Language are required.");
            }

            if (!Guid.TryParse(request.ItemId, out var itemGuid))
            {
                return BadRequest("Invalid ItemId format.");
            }

            var item = _libraryManager.GetItemById(itemGuid);
            if (item == null)
            {
                return NotFound("Item not found.");
            }

            var mediaSources = item.GetMediaSources(false);
            var primarySource = mediaSources.FirstOrDefault();
            if (primarySource == null || string.IsNullOrEmpty(primarySource.Path))
            {
                return BadRequest("No media source path found for this item.");
            }

            var filePath = primarySource.Path;

            var result = await _client.SubmitJobAsync(filePath, request.Language, HttpContext.RequestAborted).ConfigureAwait(false);

            if (result.AlreadyExists)
            {
                _logger.LogInformation("Subtitle already exists for {Path} language {Language}", filePath, request.Language);
                return Conflict(new { message = "Subtitle already exists." });
            }

            if (!result.Success)
            {
                _logger.LogError("Failed to submit subtitle job: {Error}", result.ErrorMessage);
                return StatusCode(500, new { message = result.ErrorMessage });
            }

            return Accepted(new { jobId = result.JobId, message = "Job queued successfully." });
        }

        [HttpGet("Jobs/{jobId}")]
        public async Task<IActionResult> GetJobStatus(string jobId)
        {
            if (string.IsNullOrEmpty(jobId))
            {
                return BadRequest("JobId is required.");
            }

            var status = await _client.GetJobStatusAsync(jobId, HttpContext.RequestAborted).ConfigureAwait(false);

            if (status == null)
            {
                return NotFound("Job not found.");
            }

            return Ok(status);
        }

        [HttpPost("Scan")]
        public IActionResult TriggerScan([FromBody] ScanRequest request)
        {
            if (string.IsNullOrEmpty(request.ItemId))
            {
                return BadRequest("ItemId is required.");
            }

            if (!Guid.TryParse(request.ItemId, out var itemGuid))
            {
                return BadRequest("Invalid ItemId format.");
            }

            var item = _libraryManager.GetItemById(itemGuid);
            if (item == null)
            {
                return NotFound("Item not found.");
            }

            var mediaSources = item.GetMediaSources(false);
            var primarySource = mediaSources.FirstOrDefault();
            if (primarySource == null || string.IsNullOrEmpty(primarySource.Path))
            {
                return BadRequest("No media source path found.");
            }

            var filePath = primarySource.Path;
            _libraryMonitor.ReportFileSystemChanged(filePath);
            _logger.LogInformation("Triggered library scan for {Path}", filePath);

            return Ok(new { message = "Library scan triggered." });
        }
    }

    public class SubmitJobRequest
    {
        public required string ItemId { get; set; }
        public required string Language { get; set; }
    }

    public class ScanRequest
    {
        public required string ItemId { get; set; }
    }
}

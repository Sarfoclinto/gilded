using GoldValuation.Application.Abstractions;

namespace GoldValuation.Api;

/// <summary>
/// Every failure leaves the API in the contract's shape: { "error": { code, message, fieldErrors, traceId } } with a real HTTP status.
/// Expected failures (AppException) say what went wrong; anything else is a 500 whose details stay in the logs.
/// </summary>
public sealed class ErrorEnvelopeMiddleware(RequestDelegate next, ILogger<ErrorEnvelopeMiddleware> log)
{
    public async Task Invoke(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (AppException ex) when (!context.Response.HasStarted)
        {
            await Write(context, ex.Status, ex.Code, ex.Message, ex.FieldErrors);
        }
        catch (BadHttpRequestException ex) when (!context.Response.HasStarted)
        {
            // Unreadable JSON, a malformed id or a missing required value: the caller's mistake, not a fault in the server.
            await Write(context, ex.StatusCode, "BAD_REQUEST", "The request could not be read. Check the values and try again.", null);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            context.Response.StatusCode = 499; // client went away; nothing to report
        }
        catch (Exception ex) when (!context.Response.HasStarted)
        {
            log.LogError(ex, "Unhandled error. Trace {TraceId}", context.TraceIdentifier);
            await Write(context, 500, "INTERNAL", "Something went wrong on our side. Please try again.", null);
        }
    }

    internal static Task Write(HttpContext context, int status, string code, string message, IReadOnlyDictionary<string, string[]>? fields)
    {
        context.Response.Clear();
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new
        {
            error = new { code, message, fieldErrors = fields, traceId = context.TraceIdentifier },
        });
    }
}

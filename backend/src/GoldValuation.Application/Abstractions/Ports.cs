namespace GoldValuation.Application.Abstractions;

/// <summary>Time comes from here so tests can freeze it and so server time is always the one recorded.</summary>
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

/// <summary>Who is calling and for which company. Filled from the access token; never from the request body.</summary>
public interface ICurrentContext
{
    Guid TenantId { get; }
    Guid UserId { get; }
    IReadOnlySet<Guid> BranchIds { get; }
    bool Has(string permission);
}

/// <summary>
/// A failure the caller can understand. The API turns it into the contract's error envelope
/// <c>{ "error": { "code", "message", "fieldErrors", "traceId" } }</c> with the right HTTP status.
/// </summary>
public sealed class AppException(string code, string message, int status = 400, IReadOnlyDictionary<string, string[]>? fieldErrors = null)
    : Exception(message)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
    public IReadOnlyDictionary<string, string[]>? FieldErrors { get; } = fieldErrors;

    public static AppException Forbidden(string message = "You do not have permission for this.") => new("FORBIDDEN", message, 403);
    public static AppException NotFound(string what) => new("NOT_FOUND", $"{what} was not found.", 404);
    public static AppException Conflict(string code, string message) => new(code, message, 409);
    public static AppException Invalid(string message, IReadOnlyDictionary<string, string[]>? fields = null) => new("VALIDATION_FAILED", message, 422, fields);
}

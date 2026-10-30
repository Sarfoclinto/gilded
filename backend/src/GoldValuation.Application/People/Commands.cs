namespace GoldValuation.Application.People;

/// <summary>A personal grant ("allow") or denial ("deny") on top of the person's role.</summary>
public sealed record OverrideInput(string? Permission, string? Effect);

public sealed record CreateUserCommand(
    Guid Id, string? Username, string? DisplayName, string? Email, string? Phone, string? Password, string? RoleKey,
    List<Guid>? BranchIds, List<OverrideInput>? Overrides);

public sealed record PasswordCommand(string? Password);

public sealed record ChangePasswordCommand(string? CurrentPassword, string? NewPassword);

public sealed record CreateCustomerCommand(Guid? Id, string? Name, string? Phone, string? Notes);

public sealed record MergeCustomersCommand(Guid? RemoveId);

public sealed record CreateRoleCommand(Guid? Id, string? Name, string? Description, List<string>? Permissions);

public sealed record CreateBranchCommand(Guid? Id, string? Code, string? Name, string? Timezone);
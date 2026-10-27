using GoldValuation.Infrastructure.Live;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace GoldValuation.Api.Live;

/// <summary>
/// Server-to-browser only: clients receive "changed" ({ topic }) when data they may be showing changed, "notification" when something
/// is for them to read, and "resync" after the server reconnected to the database. Nothing is sent from the browser.
/// Each connection joins the groups for its own company, branches and user, taken from the signed-in token.
/// </summary>
[Authorize]
public sealed class LiveHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        if (Guid.TryParse(user.FindFirst("tid")?.Value, out var tenant))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.Tenant(tenant));
            foreach (var claim in user.FindAll("branch"))
                if (Guid.TryParse(claim.Value, out var branch))
                    await Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.Branch(tenant, branch));
        }
        if (Guid.TryParse(user.FindFirst("sub")?.Value, out var id))
            await Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.User(id));
        await base.OnConnectedAsync();
    }
}

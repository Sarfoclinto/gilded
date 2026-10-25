using System.Reflection;

namespace GoldValuation.Api;

/// <summary>
/// Interactive API documentation (Swagger UI) built from the contract file docs/openapi.yaml, which ships inside the assembly.
/// Off unless <c>Swagger:Enabled</c> is true, so production exposes nothing. Open http://localhost:5080/docs.
/// Sign in once with POST /auth/login ("Try it out" > Execute): the page captures the access token and authorizes every other request for you.
/// </summary>
public static class DocsEndpoints
{
    private const string ShippedServer = "http://localhost:5080/api/v1";
    private static readonly Lazy<string> Yaml = new(() =>
    {
        using var stream = typeof(DocsEndpoints).Assembly.GetManifestResourceStream("openapi.yaml")
                           ?? throw new InvalidOperationException("openapi.yaml is not embedded in the API assembly.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    });

    public static WebApplication MapDocs(this WebApplication app)
    {
        if (!app.Configuration.GetValue<bool>("Swagger:Enabled")) return app;

        app.MapGet("/docs/openapi.yaml", (HttpContext http) =>
        {
            // Point "Try it out" at the host the page was opened from, so it also works on a server or another port.
            var server = $"{http.Request.Scheme}://{http.Request.Host}/api/v1";
            return Results.Text(Yaml.Value.Replace(ShippedServer, server), "application/yaml");
        }).AllowAnonymous();

        app.MapGet("/docs", () => Results.Content(Page, "text/html")).AllowAnonymous();
        app.MapGet("/", () => Results.Redirect("/docs")).AllowAnonymous();
        return app;
    }

    private const string Page = """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Gold Valuation API</title>
          <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css">
          <style>
            body { margin: 0; }
            .topbar-note { background: #14213d; color: #fff; padding: 10px 20px; font: 14px system-ui, sans-serif; }
            .topbar-note code { background: #ffffff22; padding: 1px 6px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <div class="topbar-note">
            <b>Gold Valuation API</b> &middot; development docs. Run <code>POST /auth/login</code> once; every other request is then authorized automatically.
            Sessions last 15 minutes: run <code>POST /auth/refresh</code> to renew.
          </div>
          <div id="ui"></div>
          <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
          <script>
            const ui = SwaggerUIBundle({
              url: '/docs/openapi.yaml',
              dom_id: '#ui',
              deepLinking: true,
              filter: true,
              displayRequestDuration: true,
              persistAuthorization: true,
              tryItOutEnabled: true,
              docExpansion: 'list',
              withCredentials: true,
              requestInterceptor: (req) => { req.credentials = 'include'; return req; },
              responseInterceptor: (res) => {
                try {
                  if (res.ok && /\/auth\/(login|refresh)$/.test(res.url)) {
                    ui.preauthorizeApiKey('bearerAuth', JSON.parse(res.text).data.accessToken);
                  }
                } catch (e) { /* not a session response */ }
                return res;
              },
            });
          </script>
        </body>
        </html>
        """;
}

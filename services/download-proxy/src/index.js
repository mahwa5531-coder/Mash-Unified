export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const GITHUB_REPO = env.GITHUB_REPO || "mahwa5531-coder/mash";
    const GITHUB_TOKEN = env.GITHUB_TOKEN;

    if (!GITHUB_TOKEN) {
      return new Response("Server error: GITHUB_TOKEN secret not configured on Worker", { status: 500 });
    }

    const headers = {
      "User-Agent": "Mash-Desktop-Download-Proxy",
      "Authorization": `Bearer ${GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    // 1. Fetch latest release from private repo
    const releaseRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers });
    if (!releaseRes.ok) {
      const errText = await releaseRes.text();
      return new Response(`Release not found in private repo: ${releaseRes.status} ${errText}`, { status: 404 });
    }
    const release = await releaseRes.json();

    // 2. If requesting latest.yml (for auto-updater)
    if (path.endsWith("/latest.yml") || path === "/latest.yml") {
      const asset = release.assets.find(a => a.name === "latest.yml");
      if (!asset) return new Response("latest.yml not found in release", { status: 404 });
      
      const fileRes = await fetch(asset.url, {
        headers: { ...headers, "Accept": "application/octet-stream" },
        redirect: "follow",
      });
      return new Response(fileRes.body, {
        headers: {
          "Content-Type": "text/yaml; charset=utf-8",
          "Cache-Control": "public, max-age=60",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 3. If requesting the installer (.exe), portable zip (.zip), or root download
    let targetAsset = null;
    if (path === "/portable" || path.endsWith(".zip")) {
      targetAsset = release.assets.find(a => a.name.endsWith(".zip"));
    } else if (path === "/" || path === "/download" || path === "/latest" || path.endsWith(".exe")) {
      targetAsset = release.assets.find(a => a.name.endsWith(".exe"));
    } else {
      const requestedFilename = path.split("/").pop();
      targetAsset = release.assets.find(a => a.name === requestedFilename);
    }

    if (!targetAsset) {
      return new Response(`Asset not found for path '${path}'. Available assets: ${release.assets.map(a => a.name).join(", ")}`, { status: 404 });
    }

    // 4. Request the asset URL with redirect: "manual" so GitHub returns the 302 redirect with the presigned S3/Azure URL
    const assetRedirectRes = await fetch(targetAsset.url, {
      headers: { ...headers, "Accept": "application/octet-stream" },
      redirect: "manual",
    });

    const s3Location = assetRedirectRes.headers.get("Location");
    if (s3Location) {
      return Response.redirect(s3Location, 302);
    }

    return new Response("Unable to retrieve download location from GitHub", { status: 502 });
  }
};

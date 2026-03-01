import { type NextRequest, NextResponse } from "next/server";

const ENGINE_BASE = process.env.ENGINE_URL || "http://localhost:3001";

async function proxyRequest(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await context.params;
  const targetPath = "/" + path.join("/");

  // Rebuild query string
  const search = req.nextUrl.search;
  const targetUrl = `${ENGINE_BASE}${targetPath}${search}`;

  // Forward relevant request headers (skip host)
  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (
      key.toLowerCase() !== "host" &&
      key.toLowerCase() !== "connection" &&
      key.toLowerCase() !== "content-length"
    ) {
      forwardHeaders.set(key, value);
    }
  });

  const hasBody =
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.method !== "DELETE";

  let body: BodyInit | null = null;
  if (hasBody) {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      body = await req.formData();
      // Remove content-type so fetch can set the correct multipart boundary
      forwardHeaders.delete("content-type");
    } else {
      body = await req.text();
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: body ?? undefined,
      // Don't follow redirects automatically
      redirect: "follow",
    });

    const responseHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (
        key.toLowerCase() !== "transfer-encoding" &&
        key.toLowerCase() !== "connection"
      ) {
        responseHeaders.set(key, value);
      }
    });

    const responseBody = await upstream.arrayBuffer();

    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[proxy] Engine unreachable:", err);
    return NextResponse.json(
      { error: "Engine unreachable", detail: String(err) },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
export const HEAD = proxyRequest;
export const OPTIONS = proxyRequest;

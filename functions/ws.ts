// Cloudflare Pages Function for /ws
// Bind a Durable Object namespace named SIGNALING_ROOM (pointing to the opendesk-signal Worker)
// in Cloudflare Pages -> Settings -> Functions -> Durable Object bindings.

interface PagesEnv {
  SIGNALING_ROOM?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
  };
}

export async function onRequest(context: { request: Request; env: PagesEnv }): Promise<Response> {
  const { request, env } = context;

  if (!env.SIGNALING_ROOM) {
    return new Response(
      JSON.stringify({
        error: 'SIGNALING_ROOM Durable Object binding is not configured on this Cloudflare Pages project.',
        hint: 'Deploy cloudflare/signaling-worker.ts with Wrangler and bind SIGNALING_ROOM in Pages -> Settings -> Functions, or set VITE_SIGNALING_URL.',
      }),
      {
        status: 503,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        },
      }
    );
  }

  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('OpenDesk Cloudflare Pages WebSocket Endpoint', { status: 200 });
  }

  const url = new URL(request.url);
  const roomName = url.searchParams.get('room') || 'global';
  const id = env.SIGNALING_ROOM.idFromName(roomName);
  const stub = env.SIGNALING_ROOM.get(id);
  return stub.fetch(request);
}

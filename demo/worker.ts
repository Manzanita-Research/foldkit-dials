// The demo's Worker entry. Every request is a static asset: a request that
// matches no file gets index.html, from `notFoundHandling` in alchemy.run.ts.
export default {
  fetch: (
    request: Request,
    env: Readonly<{
      ASSETS: Readonly<{ fetch: (request: Request) => Promise<Response> }>
    }>,
  ) => env.ASSETS.fetch(request),
}

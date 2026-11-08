export function onRequest({ request, env }) {
  return env.UTILITY_API.fetch(request);
}

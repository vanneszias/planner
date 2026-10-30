// Test-only entry point: the test pool wants one even though tests call
// domain functions directly.
export default { fetch: () => new Response('domain tests') }

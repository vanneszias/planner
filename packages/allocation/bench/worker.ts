/**
 * Temporary benchmark Worker: runs the engine at a given size inside the
 * Workers runtime. Clocks don't advance during CPU work in Workers, so the
 * measure is "finishes within the CPU and memory limits"; Cloudflare's own
 * CPU time per request shows in `wrangler tail`.
 *
 *   GET /?size=target|large camp|stress&fill=none|any-open
 */
import { allocate } from '../src/index.ts'
import { generate, sizes } from './generate.ts'

export default {
	fetch(request: Request): Response {
		const url = new URL(request.url)
		const size = sizes.find((s) => s.name === (url.searchParams.get('size') ?? 'target'))
		if (!size) return new Response('Unknown size', { status: 400 })
		const fill = url.searchParams.get('fill') === 'any-open' ? 'any-open' : 'none'
		const result = allocate(generate(size, 'bench', fill))
		return Response.json({
			size: size.name,
			fill,
			assignments: result.assignments.length,
			unfilledSlots: result.metrics.unfilledSlots,
			firstChoiceShare: result.metrics.firstChoiceShare,
		})
	},
}

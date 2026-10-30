/**
 * Compiles messages without starting Vite, so `pnpm typecheck` works on a
 * clean checkout (the generated src/paraglide is not committed).
 */
import { compile } from '@inlang/paraglide-js'
import { paraglideOptions } from '../paraglide.config.ts'

await compile(paraglideOptions)

import { env } from 'cloudflare:workers'
import { importTokenKey, type OpenToken, openWith, type SealToken, sealWith } from '@app/domain'
import { renderSVG } from 'uqr'

/*
 * Passes (D29): the link token sealed at rest, and the QR that carries it.
 * Server-only. The key comes from PARTICIPANT_TOKEN_KEY; a bad key throws, so
 * registrations fail loudly rather than issue passes nobody can show again.
 */

let key: Promise<CryptoKey> | undefined
const tokenKey = () => (key ??= importTokenKey(env.PARTICIPANT_TOKEN_KEY))

export const sealToken: SealToken = async (token) => sealWith(await tokenKey(), token)
export const openToken: OpenToken = async (sealed) => openWith(await tokenKey(), sealed)

/** The same private link the printed cards carry, as an SVG. */
export const passSvg = (token: string) =>
	renderSVG(`${env.BETTER_AUTH_URL}/r/${token}`, { pixelSize: 4, border: 1 })

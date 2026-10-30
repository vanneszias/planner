import { useEffect, useRef, useState } from 'react'
import { m } from '#/paraglide/messages'

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }
declare global {
	interface Window {
		BarcodeDetector?: new (options: { formats: string[] }) => Detector
	}
}

/**
 * Reads QR codes from the camera (O8). Uses the browser's BarcodeDetector
 * where it exists (Chrome on Android) and loads jsQR only where it doesn't
 * (Safari on iPhone), so most phones download nothing extra.
 */
async function qrReader(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
	if (window.BarcodeDetector) {
		const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
		return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
	}
	const { default: jsQR } = await import('jsqr')
	const canvas = document.createElement('canvas')
	const context = canvas.getContext('2d', { willReadFrequently: true })
	return async (video) => {
		if (!context || !video.videoWidth) return null
		// A smaller frame is plenty for a QR code held up to the camera, and much faster.
		const scale = Math.min(1, 640 / video.videoWidth)
		canvas.width = Math.round(video.videoWidth * scale)
		canvas.height = Math.round(video.videoHeight * scale)
		context.drawImage(video, 0, 0, canvas.width, canvas.height)
		const image = context.getImageData(0, 0, canvas.width, canvas.height)
		return (
			jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null
		)
	}
}

/**
 * The camera view. Calls `onScan` once per code; the same code is ignored
 * for a few seconds so one card held up doesn't check in twice.
 */
export function Scanner({ onScan }: { onScan: (text: string) => void }) {
	const video = useRef<HTMLVideoElement>(null)
	const callback = useRef(onScan)
	callback.current = onScan
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let stream: MediaStream | undefined
		let timer: ReturnType<typeof setTimeout> | undefined
		let stopped = false
		let last = { text: '', at: 0 }

		async function start() {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'environment' },
					audio: false,
				})
			} catch {
				setError(m.scanner_no_camera())
				return
			}
			if (stopped || !video.current) return
			video.current.srcObject = stream
			await video.current.play().catch(() => undefined)
			const read = await qrReader()
			const tick = async () => {
				if (stopped || !video.current) return
				const text = await read(video.current).catch(() => null)
				const now = Date.now()
				if (text && (text !== last.text || now - last.at > 4000)) {
					last = { text, at: now }
					callback.current(text)
				}
				timer = setTimeout(tick, 200)
			}
			tick()
		}
		start()
		return () => {
			stopped = true
			clearTimeout(timer)
			for (const track of stream?.getTracks() ?? []) track.stop()
		}
	}, [])

	if (error) {
		return (
			<p role="alert" className="rounded-xl bg-tint-warning p-4">
				{error}
			</p>
		)
	}
	return (
		<div className="overflow-hidden rounded-xl bg-ink">
			{/* The camera image has no text alternative; results are announced below. */}
			<video
				ref={video}
				muted
				playsInline
				aria-label={m.scanner_label()}
				className="aspect-square w-full object-cover sm:aspect-video"
			/>
		</div>
	)
}

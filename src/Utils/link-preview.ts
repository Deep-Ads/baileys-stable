import { Logger } from 'pino'
import { WAMediaUploadFunction, WAUrlInfo } from '../Types'
import { prepareWAMessageMedia } from './messages'
import { extractImageThumb, getHttpStream } from './messages-media'

const THUMBNAIL_WIDTH_PX = 192

/** Fetches an image and generates a thumbnail for it */
const getCompressedJpegThumbnail = async(
	url: string,
	{ thumbnailWidth, fetchOpts }: URLGenerationOptions
) => {
	const stream = await getHttpStream(url, fetchOpts)
	const result = await extractImageThumb(stream, thumbnailWidth)
	return result
}

export type URLGenerationOptions = {
	thumbnailWidth: number
	fetchOpts: {
		/** Timeout in ms */
		timeout: number
		proxyUrl?: string
		headers?: { [key: string]: string }
	}
	uploadImage?: WAMediaUploadFunction
	logger?: Logger
}

/**
 * Given a piece of text, checks for any URL present, generates link preview for the same and returns it
 * Return undefined if the fetch failed or no URL was found
 * @param text first matched URL in text
 * @returns the URL info required to generate link preview
 */
export const getUrlInfo = async(
	text: string,
	opts: URLGenerationOptions = {
		thumbnailWidth: THUMBNAIL_WIDTH_PX,
		fetchOpts: { timeout: 3000 }
	},
): Promise<WAUrlInfo | undefined> => {
	try {
		const { getLinkPreview } = await import('link-preview-js')
		let previewLink = text
		if(!text.startsWith('https://') && !text.startsWith('http://')) {
			previewLink = 'https://' + previewLink
		}

		const info = await getLinkPreview(previewLink, opts.fetchOpts)
		if(info && 'title' in info && info.title) {
			const [image] = info.images

			const urlInfo: WAUrlInfo = {
				'canonical-url': info.url,
				'matched-text': text,
				title: info.title,
				description: info.description,
				originalThumbnailUrl: image
			}

			if(opts.uploadImage) {
				if(image.startsWith('https://') || image.startsWith('http://')) {
					const { imageMessage } = await prepareWAMessageMedia(
						{ image: { url: image } },
						{ upload: opts.uploadImage, mediaTypeOverride: 'thumbnail-link' }
					)
					urlInfo.jpegThumbnail = imageMessage?.jpegThumbnail
						? Buffer.from(imageMessage.jpegThumbnail)
						: undefined
					urlInfo.highQualityThumbnail = imageMessage || undefined
				}
			} else {
				try {
					urlInfo.jpegThumbnail = image
						? (await getCompressedJpegThumbnail(image, opts)).buffer
						: undefined
				} catch(error) {
					opts.logger?.debug(
						{ err: error.stack, url: previewLink },
						'error in generating thumbnail'
					)
				}
			}

			return urlInfo
		}
	} catch(error) {
		if(!error.message.includes('receive a valid')) {
			throw error
		}
	}
}
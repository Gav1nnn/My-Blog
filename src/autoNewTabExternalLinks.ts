import type { RehypePlugin } from '@astrojs/markdown-remark';
import { visit } from 'unist-util-visit';

interface Options {
	domain: string;
}

export const autoNewTabExternalLinks: RehypePlugin = (options?: Options) => {
	const siteDomain = options?.domain ?? '';

	return (tree: unknown) => {
		visit(tree, (node: any) => {
			if (node.type != 'element') {
				return;
			}

			const element = node;

			if (!isAnchor(element)) {
				return;
			}

			const url = getUrl(element);

			if (isExternal(url, siteDomain)) {
				element.properties!['target'] = '_blank';
				element.properties!['rel'] = mergeRel(element.properties?.['rel'], ['noopener', 'noreferrer']);
			}
		});
	};
};

const isAnchor = (element: any) => element.tagName == 'a' && element.properties && 'href' in element.properties;

const getUrl = (element: any) => {
	if (!element.properties) {
		return '';
	}

	const url = element.properties['href'];

	if (!url) {
		return '';
	}

	return url.toString();
};

const mergeRel = (rel: unknown, additions: string[]) => {
	const existing = typeof rel === 'string' ? rel.split(/\s+/).filter(Boolean) : [];
	const merged = new Set([...existing, ...additions]);
	return Array.from(merged).join(' ');
};

const isSameDomain = (hostname: string, domain: string) => {
	return hostname === domain || hostname.endsWith(`.${domain}`);
};

const isExternal = (url: string, domain: string) => {
	if (!url.startsWith('http://') && !url.startsWith('https://')) {
		return false;
	}
	try {
		const hostname = new URL(url).hostname;
		return !isSameDomain(hostname, domain);
	} catch {
		return false;
	}
};

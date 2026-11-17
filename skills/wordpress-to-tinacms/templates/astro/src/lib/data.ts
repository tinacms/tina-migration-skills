/**
 * Global config loader (header, footer, site identity). Content from
 * WordPress is loaded generically in `wordpress-content.ts`.
 *
 * Replaces the starter's data.ts, whose page/blog loaders pointed at the
 * demo collections the migration removes.
 */
import { requestWithMetadata } from '@tinacms/astro/data';
import client from '../../tina/__generated__/client';

export const getConfig = () =>
	requestWithMetadata(client.queries.config({ relativePath: 'config.json' }));

export type CmsConfig = Awaited<ReturnType<typeof getConfig>>['data']['config'];
export type CmsConfigNav = NonNullable<NonNullable<CmsConfig['nav']>[number]>;
export type CmsConfigContactLink = NonNullable<NonNullable<CmsConfig['contactLinks']>[number]>;
export type CmsConfigSeo = NonNullable<CmsConfig['seo']>;

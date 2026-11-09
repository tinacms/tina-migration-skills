/**
 * Island registry for visual editing. Replaces the starter's version, which
 * also registered the demo `page` and `blog` islands. Header and footer stay
 * click-to-edit; migrated entries are edited through the /admin form.
 */
import type { IslandRegistry } from '@tinacms/astro/experimental';
import type { QueryResult } from '@tinacms/astro/data';

import type { ConfigQuery } from '../../tina/__generated__/types';
import type { CmsConfig } from './data';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import { getConfig } from './data';

export const islands: IslandRegistry = {
	global: {
		fetch: () => getConfig(),
		component: Header,
		wrapper: { tag: 'div' },
		propsFromData: (data) => ({
			config: (data as QueryResult<ConfigQuery>).data?.config as CmsConfig | undefined,
		}),
	},
	'global-footer': {
		fetch: () => getConfig(),
		component: Footer,
		wrapper: { tag: 'div' },
		propsFromData: (data) => ({
			config: (data as QueryResult<ConfigQuery>).data?.config as CmsConfig | undefined,
		}),
	},
};

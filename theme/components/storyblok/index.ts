import { add } from 'src/modules/vsf-storyblok-module/components'

add('hero', () => import('./Hero.vue'))
add('demoImage', () => import('./Image.vue'))
add('ciLink', () => import('./Link.vue'))
// Overwrite an existing component
// add('tile', () => import('./Tile.vue'), { force: true })
add('newsletter', () => import('./Newsletter.vue'))

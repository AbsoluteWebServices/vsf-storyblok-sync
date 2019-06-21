import config from 'config'
import fetch from 'isomorphic-fetch'
import { mapState } from 'vuex'
import { currentStoreView, removeStoreCodeFromRoute, storeCodeFromRoute } from '@vue-storefront/core/lib/multistore'
import qs from 'qs'
import { KEY } from '..'
import { StoryblokState } from '../types/State'

function loadScript (src: string, id: string) {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve()
      return
    }
    var script = document.createElement('script')
    script.async = true
    script.src = src
    script.id = id
    script.onerror = function onError () {
      reject(new Error('Failed to load' + src))
    }
    script.onload = function onLoad () {
      resolve()
    }
    document.getElementsByTagName('head')[0].appendChild(script)
  })
}

function getStoryblokQueryParams (route) {
  const queryString = route.fullPath.replace(route.path, '')
  const { _storyblok: id, _storyblok_c: c, _storyblok_tk: storyblok = {} } = qs.parse(queryString, { ignoreQueryPrefix: true })
  const { space_id: spaceId, timestamp, token } = storyblok

  let [_, ...fullSlug] = route.path

  if (!fullSlug) {
    fullSlug = "home"
  }
  const storeCode = storeCodeFromRoute(fullSlug)
  if (storeCode && fullSlug === removeStoreCodeFromRoute(fullSlug)) {
    fullSlug = `${fullSlug}/home`
  }

  return {
    c,
    id,
    fullSlug,
    spaceId,
    timestamp,
    token
  }
}

export default {
  name: 'Storyblok',
  metaInfo () {
    if (!this.isStatic && this.story) {
      return {
        title: this.story.name
      }
    }
    return {}
  },
  computed: {
    ...mapState(KEY, {
      loadingStory(state: StoryblokState) {
        const { id, fullSlug } = getStoryblokQueryParams(this.$route)

        const key = this.storyblokPath || id || fullSlug
        return state.stories[key] && state.stories[key].loading || false
      },
      previewToken: (state: StoryblokState) => state.previewToken,
      story(state: StoryblokState) {
        const { id, fullSlug } = getStoryblokQueryParams(this.$route)

        const key = this.storyblokPath || id || fullSlug
        return state.stories[key] && state.stories[key].story
      },
      isStatic() {
        return !!this.storyblok.path
      },
      storyblokPath() {
        const {storeCode} = currentStoreView()
        const path = this.storyblok.path
        if (this.storyblok.prependStorecode && config.storeViews.multistore && storeCode) {
          return `${storeCode}/${path}`
        }
        return path
      }
    }),
  },
  data () {
    return {
      storyblok: {
        prependStorecode: false,
        path: '',
      }
    }
  },
  methods: {
    async fetchStory () {
      const { id, fullSlug, spaceId, timestamp, token } = getStoryblokQueryParams(this.$route)

      if (id && !this.storyblokPath) {
        const previewToken = await this.$store.dispatch(`${KEY}/getPreviewToken`, {
          spaceId,
          timestamp,
          token
        })

        if (previewToken) {
          return this.$store.dispatch(`${KEY}/loadDraftStory`, {
            id,
            previewToken
          })
        }
      }

      return this.$store.dispatch(`${KEY}/loadStory`, {
        fullSlug: this.storyblokPath || fullSlug
      })
    }
  },
  async serverPrefetch () {
    const { id } = getStoryblokQueryParams(this.$route)

    if (this.$context && !id) {
      this.$context.output.cacheTags.add(KEY)
    }

    const story = await this.fetchStory()

    return { story }
  },
  async mounted () {
    if (!this.story) {
      await this.fetchStory()
    }

    if (this.previewToken) {
      const url = `https://app.storyblok.com/f/storyblok-latest.js?t=${this.previewToken}`

      await loadScript(url, 'storyblok-javascript-bridge')

      window['storyblok'].on(['input', 'published', 'change'], (event: any) => {
        if (event.action === 'input') {
          this.$store.commit(`${KEY}/updateStory`, { key: event.story.id, story: event.story })
        } else if (!(event).slugChanged) {
          window.location.reload()
        }
      })
    }
  }
}

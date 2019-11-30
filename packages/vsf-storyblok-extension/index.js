import { Router } from 'express'
import crypto from 'crypto'
import StoryblokClient from 'storyblok-js-client'
import { apiStatus } from '../../../lib/util'
import { hook } from './hook'
import { syncStories } from './sync-stories'

const log = (string) => {
  console.log('📖 : ' + string) // eslint-disable-line no-console
}

module.exports = ({ config, db }) => {
  if (!config.storyblok || !config.storyblok.previewToken) {
    throw new Error('🧱 : config.storyblok.previewToken not found')
  }
  if(!config.extensions.storyblok) {
    console.log('Storyblok Adjusted: In Order to use revised storyblok you must add config under config.extensions.storyblok. Check README for format');
  } else if (config.extensions.storyblok.multistore && config.extensions.storyblok.config.length) {
    // sync from all!
    console.log('Multistore config!')
    const api = Router()
    config.extensions.storyblok.config.map(stConfig => {
      console.log(stConfig)
      const storyblokClientConfig = {
        accessToken: stConfig.previewToken,
        cache: {
          type: 'memory'
        }
      }
      const storyblokClient = new StoryblokClient(storyblokClientConfig)
      const index = stConfig.indexName
      const storeRouter = Router()

      const multistoreConfig = Object.assign({}, config, { storyblok: stConfig })

      storeRouter.use(hook({ config: multistoreConfig, db, index, storyblokClient }))

      const getStory = (res, path) => db.search({
        index,
        type: 'story',
        body: {
          query: {
            constant_score: {
              filter: {
                term: {
                  'full_slug.keyword': path
                }
              }
            }
          }
        }
      }).then((response) => {
        const { hits } = response
        if (hits.total > 0) {
          let story = hits.hits[0]._source
          if (typeof story.content === 'string') {
            story.content = JSON.parse(story.content)
          }
          apiStatus(res, {
            story
          })
        } else {
          apiStatus(res, {
            story: false
          }, 404)
        }
      }).catch(() => {
        apiStatus(res, {
          story: false
        }, 500)
      })

      db.ping({
        requestTimeout: 30000
      }).then(async (response) => {
        try {
          log('Syncing published stories!')
          await db.indices.delete({ ignore_unavailable: true, index })
          await db.indices.create({
            index,
            body: {
              index: {
                mapping: {
                  total_fields: {
                    limit: 1000
                  }
                }
              }
            }
          })
          await syncStories({ db, index, perPage: 100, storyblokClient })
          log('Stories synced for index ' + index + '!')
        } catch (error) {
          log('Stories not synced! ' + error)
        }
      }).catch(() => {
        log('Stories not synced - no error!')
      })


      storeRouter.get('/story/', (req, res) => {
        getStory(res, 'home')
      })

      storeRouter.get('/story/:story*', (req, res) => {
        let path = req.params.story + req.params[0]
        if (config.storeViews[path]) {
          path += '/home'
        }
        getStory(res, path)
      })

      storeRouter.get('/validate-editor', async (req, res) => {
        const { spaceId, timestamp, token } = req.query

        const validationString = `${spaceId}:${config.storyblok.previewToken}:${timestamp}`
        const validationToken = crypto.createHash('sha1').update(validationString).digest('hex')

        // TODO: Give different error if timestamp is old
        if (token === validationToken && timestamp > Math.floor(Date.now() / 1000) - 3600) {
          return apiStatus(res, {
            previewToken: config.storyblok.previewToken,
            error: false
          })
        }

        return apiStatus(res, {
          error: 'Unauthorized editor'
        }, 403)
      })

      api.use('/' + index, storeRouter)
    })

    return api
  }

  const storyblokClientConfig = {
    accessToken: config.storyblok.previewToken,
    cache: {
      type: 'memory'
    }
  }

  const storyblokClient = new StoryblokClient(storyblokClientConfig)
  const index = config.storyblok.indexName ? config.storyblok.indexName : 'storyblok_stories'
  const api = Router()

  api.use(hook({ config, db, index, storyblokClient }))

  const getStory = (res, path) => db.search({
    index,
    type: 'story',
    body: {
      query: {
        constant_score: {
          filter: {
            term: {
              'full_slug.keyword': path
            }
          }
        }
      }
    }
  }).then((response) => {
    const { hits } = response
    if (hits.total > 0) {
      let story = hits.hits[0]._source
      if (typeof story.content === 'string') {
        story.content = JSON.parse(story.content)
      }
      apiStatus(res, {
        story
      })
    } else {
      apiStatus(res, {
        story: false
      }, 404)
    }
  }).catch(() => {
    apiStatus(res, {
      story: false
    }, 500)
  })

  db.ping({
    requestTimeout: 30000
  }).then(async (response) => {
    try {
      log('Syncing published stories!')
      await db.indices.delete({ ignore_unavailable: true, index })
      await db.indices.create({
        index,
        body: {
          index: {
            mapping: {
              total_fields: {
                limit: config.storyblok.fieldLimit || 1000
              }
            }
          }
        }
      })
      await syncStories({ db, index, perPage: config.storyblok.perPage, storyblokClient })
      log('Stories synced!')
    } catch (error) {
      log('Stories not synced!')
    }
  }).catch(() => {
    log('Stories not synced!')
  })

  api.get('/story/', (req, res) => {
    getStory(res, 'home')
  })

  api.get('/story/:story*', (req, res) => {
    let path = req.params.story + req.params[0]
    if (config.storeViews[path]) {
      path += '/home'
    }
    getStory(res, path)
  })

  api.get('/validate-editor', async (req, res) => {
    const { spaceId, timestamp, token } = req.query

    const validationString = `${spaceId}:${config.storyblok.previewToken}:${timestamp}`
    const validationToken = crypto.createHash('sha1').update(validationString).digest('hex')

    // TODO: Give different error if timestamp is old
    if (token === validationToken && timestamp > Math.floor(Date.now() / 1000) - 3600) {
      return apiStatus(res, {
        previewToken: config.storyblok.previewToken,
        error: false
      })
    }

    return apiStatus(res, {
      error: 'Unauthorized editor'
    }, 403)
  })

  return api
}

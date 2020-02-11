import { json, Router } from 'express'
import { apiStatus } from '../../../lib/util'
import Redis from 'ioredis'

const log = (string) => {
  console.log('📖 : ' + string) // eslint-disable-line no-console
}

const transformStory = (index) => ({ id, ...story } = {}) => {
  story.content = JSON.stringify(story.content)
  story.full_slug = story.full_slug.replace(/^\/|\/$/g, '')
  return {
    index: index,
    type: 'story', // XXX: Change to _doc once VSF supports Elasticsearch 6
    id: id,
    body: story
  }
}

function hook ({ config, esClient, db, index, storyblokClient }) {
  if (!config.storyblok || !config.storyblok.hookSecret) {
    throw new Error('🧱 : config.storyblok.hookSecret not found')
  }

  // backward compatibility for old VSF
  if (!esClient) {
    esClient = db
  }

  async function syncStory (req, res) {
    if (process.env.VS_ENV !== 'dev') {
      if (!req.query.secret) {
        return apiStatus(res, {
          error: 'Missing query param: "secret"'
        }, 403)
      }

      if (req.query.secret !== config.storyblok.hookSecret) {
        return apiStatus(res, {
          error: 'Invalid secret'
        }, 403)
      }
    }

    const cv = Date.now()
    const { story_id: id, action } = req.body
    const request = require('request')

    try {
      if (action === 'published') {
        const { data: { story } } = await storyblokClient.get(`cdn/stories/${id}`, {
          cv,
          resolve_links: 'url'
        })
        const transformedStory = transformStory(index)(story)

        await esClient.index(transformedStory)
        const globalPaths = config.storyblok.globalPaths || []

        if (globalPaths.includes(transformedStory.body.full_slug)) {
          log(`Global path found.`)

          const { code, result } = await new Promise((resolve, reject) => {
            request({
              url: config.storyblok.cacheVersionAPI,
              method: 'POST',
              json: true,
              body: {}
            }, (error, response, body) => {
              if (error) reject(new Error('Cache version request failed.'))
              else resolve(body)
            })
          })

          log(`Cache version ${result}`)

          if (parseInt(code) === 200 && result) {
            let redis = new Redis(config.redis.options)

            let stream = redis.scanStream({ match: '*' + result + 'data:page*' })
            let pipeline = redis.pipeline()

            stream.on('data', (resultKeys) => {
              resultKeys.forEach((el) => {
                pipeline.del(el)
              })
            })

            stream.on('end', () => {
              pipeline.exec(() => { log(`Cleared redis cache after global story`) })
            })
          }
        }

        log(`Published ${story.full_slug}`)
      } else if (action === 'unpublished') {
        const transformedStory = transformStory(index)({ id })
        await esClient.delete(transformedStory)
        log(`Unpublished ${id}`)
      }

      if (config.storyblok.cacheTag) {
        request(config.server.invalidateCacheForwardUrl + config.storyblok.cacheTag + '&forwardedFrom=vs', {}, (err, res, body) => {
          if (err) { console.error(err) }
          try {
            if (body && JSON.parse(body).code !== 200) console.log(body)
          } catch (e) {
            console.error('Invalid Cache Invalidation response format', e)
          }
        })
      }

      return apiStatus(res)
    } catch (error) {
      console.log('Failed fetching story', error)
      return apiStatus(res, {
        error: 'Fetching story failed'
      })
    }
  }

  const api = new Router()

  api.use(json())

  api.post('/hook', syncStory)

  return api
}

export { hook }

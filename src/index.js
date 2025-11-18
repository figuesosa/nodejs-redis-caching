import express from 'express'
import axios from 'axios'
import { createClient } from 'redis'
import responseTime from 'response-time'

const app = express()

// Colores para logs (ANSI)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
}

// Métricas de estadísticas
const stats = {
  cacheHits: 0,
  cacheMisses: 0,
  totalRequests: 0,
  startTime: Date.now()
}

// Conexion a Redis
const client = createClient({
  url: 'redis://127.0.0.1:6379'
})

// Middleware para capturar tiempo de respuesta
app.use(responseTime((req, res, time) => {
  stats.totalRequests++
  const responseTime = Math.round(time)
  const color = responseTime < 50 ? colors.green : responseTime < 200 ? colors.yellow : colors.red
  console.log(`${colors.cyan}[${new Date().toLocaleTimeString()}]${colors.reset} ${req.method} ${req.path} - ${color}${responseTime}ms${colors.reset}`)
}))

app.use(express.json())

// Handler para todos los personajes y diferentes tipos de request 
const getAllCharacters = async (req, res, next) => {
  try {
    const startTime = Date.now()
    const cacheKey = "characters:all"
    const reply = await client.get(cacheKey)

    if (reply) {
      stats.cacheHits++
      const elapsed = Date.now() - startTime
      console.log(`${colors.green}✓ CACHE HIT${colors.reset} - All characters (${elapsed}ms)`)
      return res.send({
        ...JSON.parse(reply),
        _cache: true,
        _responseTime: elapsed
      })
    }

    stats.cacheMisses++
    console.log(`${colors.yellow}✗ CACHE MISS${colors.reset} - Fetching all characters from API...`)
    const { data } = await axios.get(
      "https://rickandmortyapi.com/api/character"
    )

    const saveResult = await client.set(
      cacheKey,
      JSON.stringify(data),
      {
        EX: 10,
      }
    )
    const elapsed = Date.now() - startTime
    console.log(`${colors.blue}→ Saved${colors.reset} all characters to cache (TTL: 10s) - ${elapsed}ms`)

    res.send({
      ...data,
      _cache: false,
      _responseTime: elapsed
    })
  } catch (error) {
    console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`)
    res.status(500).send({ error: error.message })
  }
}

// Todos los personajes (plural - RESTful)
app.get("/characters", getAllCharacters)

// Usando Alias para un solo personaje (singular)
app.get("/character", getAllCharacters)

// Usando ID para un solo Personaje
const getCharacterById = async (req, res, next) => {
  try {
    const startTime = Date.now()
    const { id } = req.params
    const cacheKey = `character:${id}`
    
    // Al hacer la request se revisa la instancia de Redis
    const reply = await client.get(cacheKey)

    if (reply) {
      stats.cacheHits++
      const elapsed = Date.now() - startTime
      const character = JSON.parse(reply)
      console.log(`${colors.green}✓ CACHE HIT${colors.reset} - Character #${id}: ${character.name} (${elapsed}ms)`)
      return res.send({
        ...character,
        _cache: true,
        _responseTime: elapsed
      })
    }

    // Si no esta en cache (ram), se saca de API
    stats.cacheMisses++
    console.log(`${colors.yellow}✗ CACHE MISS${colors.reset} - Fetching character ID: ${id} from API...`)
    const { data } = await axios.get(
      `https://rickandmortyapi.com/api/character/${id}`
    )
    
    // Guarda al Redis temporalmente, expira en 15 segundos
    const saveResult = await client.set(
      cacheKey,
      JSON.stringify(data),
      {
        EX: 15,
      }
    )

    const elapsed = Date.now() - startTime
    console.log(`${colors.blue}→ Saved${colors.reset} character #${id}: ${data.name} to cache (TTL: 15s) - ${elapsed}ms`)

    res.send({
      ...data,
      _cache: false,
      _responseTime: elapsed
    })
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`${colors.red}✗ NOT FOUND${colors.reset} - Character ID: ${req.params.id}`)
      return res.status(404).send({ error: `Character with ID ${req.params.id} not found` })
    }
    console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`)
    res.status(500).send({ error: error.message })
  }
}

// (plural - RESTful)
app.get("/characters/:id", getCharacterById)

// (singular)
app.get("/character/:id", getCharacterById)

// Búsqueda de personajes por nombre
app.get("/characters/search/:name", async (req, res) => {
  try {
    const startTime = Date.now()
    const { name } = req.params
    const cacheKey = `character:search:${name.toLowerCase()}`
    
    const reply = await client.get(cacheKey)
    
    if (reply) {
      stats.cacheHits++
      const elapsed = Date.now() - startTime
      console.log(`${colors.green}✓ CACHE HIT${colors.reset} - Search: "${name}" (${elapsed}ms)`)
      return res.send({
        ...JSON.parse(reply),
        _cache: true,
        _responseTime: elapsed
      })
    }

    stats.cacheMisses++
    console.log(`${colors.yellow}✗ CACHE MISS${colors.reset} - Searching for: "${name}"...`)
    const { data } = await axios.get(
      `https://rickandmortyapi.com/api/character/?name=${encodeURIComponent(name)}`
    )

    const saveResult = await client.set(
      cacheKey,
      JSON.stringify(data),
      { EX: 30 }
    )

    const elapsed = Date.now() - startTime
    console.log(`${colors.blue}→ Saved${colors.reset} search results for "${name}" to cache (TTL: 30s) - ${elapsed}ms`)

    res.send({
      ...data,
      _cache: false,
      _responseTime: elapsed
    })
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.status(404).send({ error: `No characters found with name "${req.params.name}"` })
    }
    console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`)
    res.status(500).send({ error: error.message })
  }
})

// Endpoint de estadísticas
app.get("/stats", async (req, res) => {
  try {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000)
    const cacheHitRate = stats.totalRequests > 0 
      ? ((stats.cacheHits / stats.totalRequests) * 100).toFixed(2) 
      : 0
    
    // Obtener número de claves en Redis
    const keys = await client.dbSize()

    res.send({
      cache: {
        hits: stats.cacheHits,
        misses: stats.cacheMisses,
        hitRate: `${cacheHitRate}%`,
        totalKeys: keys
      },
      requests: {
        total: stats.totalRequests
      },
      server: {
        uptime: `${uptime}s`,
        uptimeFormatted: formatUptime(uptime)
      },
      redis: {
        connected: client.isOpen,
        keysInCache: keys
      }
    })
  } catch (error) {
    res.status(500).send({ error: error.message })
  }
})

// Endpoint para limpiar el cache
app.delete("/cache", async (req, res) => {
  try {
    const result = await client.flushDb()
    console.log(`${colors.magenta}🗑️  Cache cleared${colors.reset}`)
    res.send({ 
      message: "Cache cleared successfully",
      result 
    })
  } catch (error) {
    console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`)
    res.status(500).send({ error: error.message })
  }
})

// Endpoint de información
app.get("/", (req, res) => {
  res.send({
    message: "Redis Caching Demo API",
    endpoints: {
      "GET /characters": "Get all characters",
      "GET /character/:id": "Get character by ID",
      "GET /characters/search/:name": "Search characters by name",
      "GET /stats": "Get cache statistics",
      "DELETE /cache": "Clear all cache"
    },
    example: {
      getAll: "http://localhost:3000/characters",
      getById: "http://localhost:3000/character/1",
      search: "http://localhost:3000/characters/search/rick",
      stats: "http://localhost:3000/stats"
    }
  })
})

// Función auxiliar para formatear uptime
function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return `${hours}h ${minutes}m ${secs}s`
}

const main = async () => {
  try {
    await client.connect()
    console.log(`${colors.green}✓${colors.reset} Connected to Redis`)
    
    app.listen(3000, () => {
      console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`)
      console.log(`${colors.bright}${colors.cyan}║      Redis Caching Demo Server         ║${colors.reset}`)
      console.log(`${colors.bright}${colors.cyan}║   Listening on port 3000               ║${colors.reset}`)
      console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}`)
      console.log(`\n${colors.bright}Endpoints:${colors.reset}`)
      console.log(`  ${colors.cyan}GET${colors.reset}  /characters - Get all characters`)
      console.log(`  ${colors.cyan}GET${colors.reset}  /character/:id - Get character by ID`)
      console.log(`  ${colors.cyan}GET${colors.reset}  /characters/search/:name - Search by name`)
      console.log(`  ${colors.cyan}GET${colors.reset}  /stats - View cache statistics`)
      console.log(`  ${colors.red}DELETE${colors.reset} /cache - Clear cache\n`)
    })
  } catch (error) {
    console.log(`${colors.red} Error connecting to Redis: ${error.message}${colors.reset}`)
    console.log(`${colors.yellow}Make sure Redis is running (docker-compose up)${colors.reset}`)
    process.exit(1)
  }
}

main()

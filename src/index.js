import express from 'express'
import axios from 'axios'
import { createClient } from 'redis'
import responseTime from 'response-time'

const app = express()

// Connecting to redis
const client = createClient({
  url: 'redis://127.0.0.1:6379'
})

app.use(responseTime())

// Handler for getting all characters
const getAllCharacters = async (req, res, next) => {
  try {
    const cacheKey = "characters:all"
    const reply = await client.get(cacheKey)

    if (reply) {
      console.log("Using cached data for all characters")
      return res.send(JSON.parse(reply))
    }

    console.log("Fetching all characters from API")
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
    console.log(`Saved all characters to cache - ${saveResult}`)

    res.send(data)
  } catch (error) {
    res.status(500).send({ error: error.message })
  }
}

// Get all characters (plural - RESTful)
app.get("/characters", getAllCharacters)

// Alias for backward compatibility (singular)
app.get("/character", getAllCharacters)

// Handler for getting a single character by ID
const getCharacterById = async (req, res, next) => {
  try {
    const { id } = req.params
    const cacheKey = `character:${id}`
    
    // Check Redis cache first
    const reply = await client.get(cacheKey)

    if (reply) {
      console.log(`Using cached data for character ID: ${id}`)
      return res.send(JSON.parse(reply))
    }

    // If not in cache, fetch from API
    console.log(`Fetching character ID: ${id} from API`)
    const { data } = await axios.get(
      `https://rickandmortyapi.com/api/character/${id}`
    )
    
    // Save to Redis cache with 15 second expiration
    const saveResult = await client.set(
      cacheKey,
      JSON.stringify(data),
      {
        EX: 15,
      }
    )

    console.log(`Saved character ID: ${id} to cache - ${saveResult}`)

    res.send(data)
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.status(404).send({ error: `Character with ID ${req.params.id} not found` })
    }
    res.status(500).send({ error: error.message })
  }
}

// Get a single character by ID (plural - RESTful)
app.get("/characters/:id", getCharacterById)

// Alias for backward compatibility (singular)
app.get("/character/:id", getCharacterById)

const main = async () => {
  try {
    await client.connect()
    app.listen(3000)
    console.log("Server listening on port 3000")
  } catch (error) {
    process.exit(1)
  }
}

main()

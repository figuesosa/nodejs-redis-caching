import express from 'express'
import axios from 'axios'
import { createClient } from 'redis'
import responseTime from 'response-time'

const app = express()

// Conexion a Redis
const client = createClient({
  url: 'redis://127.0.0.1:6379'
})

app.use(responseTime())

// Handler para todos los personajes y diferentes tipos de request 
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

// Todos los personajes (plural - RESTful)
app.get("/characters", getAllCharacters)

// Usando Alias para un solo personaje (singular)
app.get("/character", getAllCharacters)

// Usando ID para un solo Personaje
const getCharacterById = async (req, res, next) => {
  try {
    const { id } = req.params
    const cacheKey = `character:${id}`
    
    // Al hacer la request se revisa la instancia de Redis
    const reply = await client.get(cacheKey)

    if (reply) {
      console.log(`Using cached data for character ID: ${id}`)
      return res.send(JSON.parse(reply))
    }

    // Si no esta en cache (ram), se saca de API
    console.log(`Fetching character ID: ${id} from API`)
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

    console.log(`Saved character ID: ${id} to cache - ${saveResult}`)

    res.send(data)
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.status(404).send({ error: `Character with ID ${req.params.id} not found` })
    }
    res.status(500).send({ error: error.message })
  }
}

// (plural - RESTful)
app.get("/characters/:id", getCharacterById)

// (singular)
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

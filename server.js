const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const axios = require('axios');
const cors = require('cors');

dotenv.config();

const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;

// Configuración de OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuración del servidor
const app = express();

// Middleware para parsear JSON
app.use(bodyParser.json());

// Configuración de CORS
app.use(cors({
  origin: 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Función para obtener el token de Amadeus
const getAmadeusToken = async () => {
  try {
    console.log('Intentando autenticar con Amadeus...');
    const response = await axios.post(
      'https://test.api.amadeus.com/v1/security/oauth2/token',
      `grant_type=client_credentials&client_id=${process.env.AMADEUS_API_KEY}&client_secret=${process.env.AMADEUS_API_SECRET}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log('Token obtenido:', response.data.access_token);
    return response.data.access_token;
  } catch (error) {
    console.error('Error al obtener el token de Amadeus:', error.response?.data || error.message);
    throw new Error('No se pudo autenticar con la API de Amadeus.');
  }
};

// Función para consultar la API de Amadeus para vuelos
const getFlights = async (origin, destination, date) => {
  try {
    const token = await getAmadeusToken();
    console.log(`Buscando vuelos de ${origin} a ${destination} en la fecha ${date}`);
    const response = await axios.get('https://test.api.amadeus.com/v2/shopping/flight-offers', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        originLocationCode: origin,
        destinationLocationCode: destination,
        departureDate: date,
        adults: 1,
      },
    });

    const flightData = response.data.data.map(flight => ({
      airline: flight.validatingAirlineCodes[0],
      price: flight.price.total,
      departure: flight.itineraries[0].segments[0].departure,
      arrival: flight.itineraries[0].segments[0].arrival,
    }));

    console.log('Vuelos encontrados:', flightData);
    return flightData;
  } catch (error) {
    console.error('Error al obtener vuelos de Amadeus:', error.response?.data || error.message);
    throw new Error('No se pudo obtener información de vuelos.');
  }
};

// Función para consultar imágenes de un país usando Pixabay
const getCountryImages = async (country) => {
  try {
    console.log(`Buscando imágenes de ${country}`);
    const response = await axios.get('https://pixabay.com/api/', {
      params: {
        key: PIXABAY_API_KEY,
        q: country,
        image_type: 'photo',
        per_page: 5,
      },
    });

    const images = response.data.hits.map(hit => hit.webformatURL);
    console.log(`Imágenes encontradas para ${country}:`, images);
    return images;
  } catch (error) {
    console.error('Error al obtener imágenes de Pixabay:', error.response?.data || error.message);
    return [];
  }
};

// Endpoint del chatbot
app.post('/chat', async (req, res) => {
  const userMessage = req.body.message;

  try {
    console.log('Mensaje recibido del usuario:', userMessage);

    // Detectar si el mensaje contiene información de vuelos
    const flightRegex = /origen:\s*(\w+),\s*destino:\s*(\w+),\s*fecha:\s*([\d-]+)/i;
    const matches = userMessage.match(flightRegex);

    if (matches) {
      console.log('Datos de vuelo detectados:', matches);

      const [, origin, destination, date] = matches;

      // Llamar a la API de Amadeus para vuelos
      const flightData = await getFlights(origin, destination, date);

      if (flightData.length === 0) {
        res.json({ reply: 'No se encontraron vuelos disponibles para esa ruta y fecha.' });
      } else {
        res.json({
          reply: 'Aquí tienes la información de vuelos:',
          flights: flightData,
        });
      }
    } else {
      // Detectar si el mensaje es sobre un país
      const countryRegex = /hablame de\s*(\w+)/i;
      const countryMatch = userMessage.match(countryRegex);

      if (countryMatch) {
        const country = countryMatch[1];
        console.log(`Solicitud de información sobre el país: ${country}`);

        // Obtener imágenes del país
        const images = await getCountryImages(country);

        // Consultar a GPT-4 sobre el país
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'Eres un asistente amigable llamado TravelBot que puede responder a cualquier tipo de consulta sobre viajes, cuando te pregunten sobre un pais dales el formato origen, destino y fecha para el vuelo ademas dale el iata del pais de origen y de destino asi como un ejemplo de fecha, puede ser origen: SAL, destino: MAD, fecha: aaaa-mm-ddd Importante que les proporciones el codigo IATA Paa buscar mejor ejemplo si te dicen que quieren visitar el salvador les de el iata SAL.' },
            { role: 'user', content: userMessage },
          ],
        });

        const assistantMessage = gptResponse.choices[0].message.content;

        res.json({
          reply: assistantMessage,
          images,
        });
      } else {
        // Respuesta genérica con GPT-4
        console.log('Mensaje general detectado. Consultando GPT-4...');
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'Eres un asistente amigable llamado TravelBot que puede responder a cualquier tipo de consulta sobre viajes, cuando te pregunten sobre un pais dales el formato origen, destino y fecha para el vuelo ademas dale el iata del pais de origen y de destino asi como un ejemplo de fecha, puede ser origen: SAL, destino: MAD, fecha: aaaa-mm-ddd, pero importante que les el formato que deben introducir nuevamente si te ponen quiero ir a el salvador desde uruguay el 2 de enero del 2025 tu les tienes que responder solamente el formato que debe poner y mencionarles que pongan ese formato solamente dales el formato no le pongas el aeropuerto en el formato que eso no lo lee el sistema. Cuando te pidan reservar les dices que pueden hacer su reserva en www.booking.com' },
            { role: 'user', content: userMessage },
          ],
        });

        const assistantMessage = gptResponse.choices[0].message.content;
        res.json({ reply: assistantMessage });
      }
    }
  } catch (error) {
    console.error('Error en el procesamiento:', error.message);
    res.status(500).json({ error: `Ocurrió un error al procesar tu solicitud: ${error.message}` });
  }
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

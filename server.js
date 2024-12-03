import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import axios from 'axios';

dotenv.config();

// Configuración de OpenAII
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


// Configuración del servidor
const app = express();
app.use(bodyParser.json());

// Función para obtener el token de Amadeus
const getAmadeusToken = async () => {
    try {
      console.log('Intentando autenticar con Amadeus...');
      const response = await axios.post(
        'https://test.api.amadeus.com/v1/security/oauth2/token',
        'grant_type=client_credentials&client_id=' + process.env.AMADEUS_API_KEY + '&client_secret=' + process.env.AMADEUS_API_SECRET,
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

// Función para consultar la API de Amadeus
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
    console.error('Error al obtener vuelos de Amadeus:', error.message);
    throw new Error('No se pudo obtener información de vuelos.');
  }
};

// Endpoint del chatbot
app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
  
    try {
      // Intentar extraer información directamente del mensaje del usuario
      const matches = userMessage.match(/origen:\s*(\w+),\s*destino:\s*(\w+),\s*fecha:\s*([\d-]+)/i);
  
      if (matches) {
        // Si se encuentran los datos necesarios, llama a la API de Amadeus
        const [, origin, destination, date] = matches;
        console.log('Datos extraídos del mensaje:', { origin, destination, date });
        const flightData = await getFlights(origin, destination, date);
  
        if (flightData.length === 0) {
          res.json({ reply: 'No se encontraron vuelos disponibles para esa ruta y fecha.' });
        } else {
          res.json({
            reply: `Aquí tienes la información de vuelos:\n${JSON.stringify(flightData, null, 2)}`,
          });
        }
      } else {
        // Si no se encuentran los datos, solicita más detalles con GPT-4
        console.log('No se encontraron datos en el mensaje del usuario. Pidiendo aclaraciones...');
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'Eres un asistente de viajes experto en vuelos.' },
            { role: 'user', content: userMessage },
          ],
        });
  
        const assistantMessage = gptResponse.choices[0].message.content;
        res.json({ reply: assistantMessage });
      }
    } catch (error) {
      console.error('Error en el chatbot:', error.message);
      res.status(500).json({ error: 'Ocurrió un error al procesar tu solicitud.' });
    }
  });

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

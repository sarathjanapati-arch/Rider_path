# Rider Tracker

A real-time rider location tracking and analytics system for delivery operations. Track rider movements throughout the day, visualize routes, calculate distances, and generate performance reports.

## Features

- **Real-Time Tracking** - Live WebSocket updates for rider locations
- **Route Analysis** - Integration with Valhalla routing engine for accurate distance calculations
- **Daily Analytics** - Automatic daily summaries including total distance, stops, and route segments
- **Multi-Format Exports** - Generate CSV and PDF reports of daily rider activities
- **Authentication** - Optional session-based authentication for secure access
- **Caching** - Built-in caching for improved performance on frequently accessed data
- **Responsive Tracking** - Track multiple riders simultaneously with 15-second update intervals

## Tech Stack

- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL
- **Real-Time Communication**: Socket.IO
- **Routing**: Valhalla (OpenStreetMap)
- **HTTP Client**: Axios
- **Process Management**: Nodemon (development)

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database with rider location data
- Valhalla routing service (local or remote)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd rider-tracker
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the project root with the following variables:
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=your_database
DB_USER=your_user
DB_PASSWORD=your_password

# Server Configuration
PORT=3000
VALHALLA_URL=https://valhalla1.openstreetmap.de/route
GAP_MINUTES=15

# Authentication (Optional)
AUTH_USER=your_username
AUTH_PASSWORD=your_password

# Session Configuration
SESSION_TTL_MS=43200000
CACHE_TTL_MS=600000
```

## Usage

### Development

Run with automatic reload on file changes:
```bash
npm run dev
```

### Production

Start the server:
```bash
npm start
```

The server will start at `http://localhost:3000` (or the configured PORT).

## API Endpoints

### Health Check
- `GET /api/health` - Check server status and configuration

### Rider Management
- `GET /api/riders` - Get all riders with active location data
- `GET /api/riders/:id/dates` - Get overview of all dates for a rider
- `GET /api/riders/:id/pings/:date` - Get raw location pings for a specific date
- `GET /api/riders/:id/stores/:date` - Get store/stop locations for the day
- `GET /api/riders/:id/route/:date` - Get route segments and distance metrics
- `GET /api/riders/:id/day/:date` - Get complete daily payload

### Exports
- `GET /api/riders/:id/export/:date.csv` - Export daily data as CSV
- `GET /api/riders/:id/export/:date.pdf` - Export daily data as PDF

### Authentication
- `POST /api/auth/login` - User login endpoint (if authentication enabled)

## WebSocket Events

### Client to Server
- `subscribe_live` - Subscribe to live updates for a rider
  ```javascript
  socket.emit('subscribe_live', { riderId: 'rider_123' });
  ```
- `unsubscribe_live` - Stop receiving live updates

### Server to Client
- `live_snapshot` - Initial batch of recent pings (last 50)
  ```javascript
  { riderId: 'rider_123', pings: [...] }
  ```
- `new_pings` - New location updates as they arrive
  ```javascript
  { pings: [...], routeSegments: [...] }
  ```

## Project Structure

```
rider-tracker/
├── src/
│   ├── config.js              # Environment configuration
│   ├── utils.js               # Utility functions
│   ├── db/
│   │   ├── pool.js            # PostgreSQL connection pool
│   │   └── queries/
│   │       └── riders.js      # Rider data queries
│   ├── services/
│   │   ├── cache.js           # Caching logic
│   │   ├── routing.js         # Valhalla routing integration
│   │   └── dayBuilder.js      # Daily summary building
│   ├── routes/
│   │   ├── auth.js            # Authentication routes
│   │   └── riders.js          # Rider API routes
│   ├── middleware/
│   │   └── auth.js            # Authentication middleware
│   └── sockets/
│       └── live.js            # WebSocket live tracking
├── public/                    # Static frontend files
├── reports/                   # Report generation modules
├── server.js                  # Application entry point
├── package.json               # Dependencies
└── .env                       # Environment variables
```

## Database Schema

The application expects the following database tables:

### Core Tables
- `acin_oms.rider_live_location` - Rider location pings
  - `rider_id` - Unique rider identifier
  - `latitude` - Location latitude
  - `longitude` - Location longitude
  - `date` - Timestamp of the ping

- `acin_auth.employee_profile` - Rider information
  - `id` - Rider ID
  - `first_name` - Rider's first name
  - `last_name` - Rider's last name

## Configuration

All configuration is managed through environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `VALHALLA_URL` | https://valhalla1.openstreetmap.de/route | Routing service endpoint |
| `GAP_MINUTES` | 15 | Time gap for identifying separate trips |
| `CACHE_TTL_MS` | 600000 | Cache expiration time (10 minutes) |
| `SESSION_TTL_MS` | 43200000 | Session timeout (12 hours) |
| `AUTH_USER` | - | Username for authentication |
| `AUTH_PASSWORD` | - | Password for authentication |

## Development

### Running Tests
```bash
npm test
```

### Using Nodemon
The development script uses nodemon for automatic restart:
```bash
npm run dev
```

Watch mode watches for changes in the `src/` directory and restarts the server automatically.

## Performance Considerations

- **Caching**: Location summaries are cached for 10 minutes by default
- **Database Queries**: Indexed queries on `rider_id` and `date` for optimal performance
- **Live Updates**: 15-second polling interval for real-time location updates
- **Batch Operations**: Route calculations are batched per location ping

## Error Handling

The application includes:
- Fallback routing (straight line distance) if Valhalla service is unavailable
- Graceful handling of missing rider profiles
- Validation of location data (non-null, non-empty coordinates)
- Connection pooling for database reliability

## Security

- **Authentication**: Optional username/password authentication with session cookies
- **CORS**: Configurable CORS for API access
- **Input Validation**: SQL parameterization to prevent injection attacks
- **Session Management**: Secure session handling with configurable TTL

## Troubleshooting

### Database Connection Issues
- Verify PostgreSQL is running and accessible
- Check credentials in `.env` file
- Ensure database and tables exist

### Valhalla Service Issues
- If Valhalla is unavailable, the system falls back to straight-line distance
- Verify `VALHALLA_URL` is correct and accessible

### WebSocket Connection Issues
- Ensure Socket.IO is properly configured
- Check authentication credentials if enabled
- Verify client-side Socket.IO version compatibility

## License

[Your License Here]

## Support

For issues, questions, or contributions, please contact the development team.

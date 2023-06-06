# Player Management System

This is a player management system built with React, Express, and PostgreSQL. The application allows a user to view players based on their positions, add them to a roster, and remove them from the roster.

## Features
- Filter players by their positions.
- Add players to the roster and manage the team.
- Pagination feature for ease of navigation.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

Before you begin, ensure you have installed:
- Node.js
- npm
- PostgreSQL

### Installing

1. Clone the repository to your local machine.
```
git clone https://github.com/your-username/player-management-system.git
```
2. Install the dependencies.
```
npm install
```
3. Create a `.env` file in your root directory and add the following variables:
```shell
RAPID_API_KEY=your_rapidapi_key
RAPID_API_HOST=your_rapidapi_host
```
4. Run the app in the development mode.
```
npm start
```
Open [http://localhost:3000](http://localhost:3000) to view it in the browser. 

### Database Setup

1. Create a new PostgreSQL database named `player_management_system`.

2. Run the SQL commands in the `database.sql` file in the root directory to create the necessary tables and insert test data.

### Built With

- React.js
- Node.js
- Express.js
- PostgreSQL
- Material-UI
- Axios

## API Reference

The API has two endpoints:

1. `/api/players?page={pageNumber}&position={positionFilter}` - Returns a paginated list of players. You can filter by position.

2. `/api/players/draft/{playerId}` - Adds a player to the roster.

3. `/api/team/roster/{playerId}` - Removes a player from the roster.

## Contributing

We love contributions! Please refer to our [Contribution Guide](CONTRIBUTING.md) for details on how to contribute.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
# ✦ Sereno — Private Travel Concierge

## Setup Instructions

### 1. Install Node.js
Download and install from: https://nodejs.org (choose LTS version)

### 2. Set up your API keys
Inside the `sereno-backend` folder, create a file called `.env` and paste this in:

```
OPENROUTER_API_KEY=your_openrouter_key_here
SERPER_API_KEY=your_serper_key_here
SENDGRID_API_KEY=your_sendgrid_key_here
SENDGRID_FROM_EMAIL=sereno.travel.luxe@gmail.com
SENDGRID_FROM_NAME=Sereno
PORT=3000
```

Replace each `your_xxx_key_here` with your actual keys.

### 3. Install dependencies
Open a terminal, navigate to the `sereno-backend` folder and run:

```bash
npm install
```

### 4. Start the server
```bash
npm start
```

### 5. Open the app
Go to: http://localhost:3000

That's it! ✦
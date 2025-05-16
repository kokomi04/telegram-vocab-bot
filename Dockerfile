FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Switch to non-root user for security
USER node

# Start the application
CMD ["node", "bot.js"] 
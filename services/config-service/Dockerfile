# Stage 1: Build the application
FROM node:22-alpine AS builder

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies required for the build)
RUN npm install

# Copy the rest of the application code
COPY . .

# Stage 2: Production image
FROM node:22-alpine

# Set the working directory
WORKDIR /usr/src/app

# Set environment variable for production
ENV NODE_ENV=production
ENV DOCKER_ENV=true

# Copy package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy src directory
COPY --from=builder /usr/src/app/src ./src

# Expose the port the app runs on
EXPOSE 9000

# Start the application using the production script
CMD ["npm", "start"]

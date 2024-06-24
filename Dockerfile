# Stage 1: Build the application
FROM node:20-alpine as builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and yarn.lock files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the TypeScript source files
COPY src ./src

# Copy tsconfig.json
COPY tsconfig.json ./

# Build the application
RUN yarn build

# Stage 2: Setup the runtime container
FROM node:20-alpine

WORKDIR /app

# Copy package.json along with the built JavaScript files and node_modules
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

# Expose the port the app runs on
EXPOSE 3000

# Run the application
CMD ["node", "dist/index.js"]

# Stage 1: Build the application
FROM python:3.11-slim AS builder

# Set the working directory
WORKDIR /usr/src/app

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy requirements.txt to leverage Docker layer caching
COPY requirements.txt ./

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Stage 2: Production image
FROM python:3.11-slim

# Set the working directory
WORKDIR /usr/src/app

# Copy the virtualenv from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Set environment variables for production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Copy the rest of the application code
COPY --from=builder /usr/src/app/ ./

# Expose the port the app runs on
EXPOSE 5000

# Start the application
CMD ["python", "main.py"]

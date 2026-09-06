"""Celery Distributed Task Queue Application for AutoCFO.

Configured with RabbitMQ as the message broker (`amqp://guest:guest@localhost:5672//`)
and RPC result backend for asynchronous invoice vision extraction.
"""

import logging
import os
import sys

# Ensure project root is in sys.path for Celery fork pool workers
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from celery import Celery
from file_extractor import extract_and_persist_invoice

logger = logging.getLogger("autocfo.celery")

# Broker and backend configuration
RABBITMQ_BROKER_URL = os.getenv(
    "CELERY_BROKER_URL", "amqp://guest:guest@localhost:5672//"
)
CELERY_RESULT_BACKEND = os.getenv(
    "CELERY_RESULT_BACKEND", "rpc://"
)

celery_app = Celery(
    "autocfo_tasks",
    broker=RABBITMQ_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

# Celery Configuration Options
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,        # 5 minutes max
    broker_connection_retry_on_startup=True,
)


@celery_app.task(bind=True, name="extract_invoice_task")
def extract_invoice_task(self, file_path: str):
    """Celery background task that extracts invoice data and saves to PostgreSQL.

    Args:
        file_path: Path to the saved invoice file in ./temp directory.

    Returns:
        Dict with extracted invoice details and database invoice_id.
    """
    logger.info("Celery Task [%s] triggered for file: %s", self.request.id, file_path)
    self.update_state(state="PROGRESS", meta={"status": "Extracting text and vision with AI..."})

    try:
        result = extract_and_persist_invoice(file_path)
        logger.info("Celery Task [%s] completed successfully: %s", self.request.id, result)
        return result
    except Exception as exc:
        logger.error("Celery Task [%s] failed with exception: %s", self.request.id, exc, exc_info=True)
        # Re-raise so Celery marks task as FAILURE
        raise exc

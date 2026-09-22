"""SNS push notifications for context-window threshold alerts.

Publishing is best-effort: a missing topic ARN, absent credentials, or an SNS
outage degrades to "no alert" rather than failing the user's request. The
endpoint reports what actually happened so the UI never claims an alert it
did not send.
"""
import asyncio
import logging
from typing import Optional

import config

logger = logging.getLogger(__name__)

_client = None
_client_failed = False


def _get_client():
    """Lazily build the SNS client so import never depends on AWS being present."""
    global _client, _client_failed
    if _client is not None or _client_failed:
        return _client
    try:
        import boto3

        _client = boto3.client("sns", region_name=config.AWS_REGION)
    except Exception as exc:
        logger.warning("SNS client unavailable, alerts disabled: %s", exc)
        _client_failed = True
    return _client


def is_enabled() -> bool:
    return bool(config.SNS_TOPIC_ARN)


def _publish_sync(subject: str, message: str) -> dict:
    if not is_enabled():
        return {"sent": False, "reason": "SNS_TOPIC_ARN not configured"}

    client = _get_client()
    if client is None:
        return {"sent": False, "reason": "boto3/SNS client unavailable"}

    try:
        response = client.publish(
            TopicArn=config.SNS_TOPIC_ARN,
            # SNS caps Subject at 100 chars and rejects newlines.
            Subject=subject[:100].replace("\n", " "),
            Message=message,
        )
        return {"sent": True, "message_id": response.get("MessageId")}
    except Exception as exc:
        logger.warning("SNS publish failed: %s", exc)
        return {"sent": False, "reason": str(exc)}


async def publish_threshold_alert(
    percent_used: float,
    total_tokens: int,
    purged: int,
    session_id: Optional[str] = None,
) -> dict:
    """Announce that a chat session crossed the purge threshold."""
    threshold_pct = config.PURGE_THRESHOLD * 100
    subject = f"LLM X-Ray: context window at {percent_used:.1f}%"
    message = "\n".join(
        [
            "LLM X-Ray context window threshold alert",
            "",
            f"Session:         {session_id or 'anonymous'}",
            f"Context used:    {percent_used:.2f}% of {config.CONTEXT_LIMIT:,} tokens",
            f"Tokens in use:   {total_tokens:,}",
            f"Threshold:       {threshold_pct:.0f}%",
            f"Messages purged: {purged}",
            "",
            "The oldest messages were dropped from the active context to keep the",
            "conversation under the model's limit.",
        ]
    )
    # boto3 is synchronous; keep it off the event loop.
    return await asyncio.to_thread(_publish_sync, subject, message)

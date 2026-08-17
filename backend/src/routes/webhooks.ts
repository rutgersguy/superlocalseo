import { Router, Request, Response } from 'express';
import { stripe, handleWebhookEvent } from '../services/stripe.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { verifyEmrWebhook } from '../middleware/verifyEmrWebhook';
import { handleEmrWebhook } from '../controllers/emr_webhook.controller';

const router = Router();

// Stripe requires raw body — must be registered before json() middleware
router.post('/stripe', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'] as string;
  if (!sig || !config.stripe.webhookSecret) { res.status(400).send('Missing signature'); return; }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (e: any) {
    logger.warn('Stripe webhook signature invalid', { error: e.message });
    res.status(400).send(`Webhook error: ${e.message}`);
    return;
  }

  try {
    await handleWebhookEvent(event);
    res.json({ received: true });
  } catch (e) {
    logger.error('Stripe webhook handler failed', { error: e, eventType: event.type });
    res.status(500).send('Handler error');
  }
});

// EMR inbound webhook. Authenticated with the shared token (query param or
// header) — see middleware/verifyEmrWebhook. This is the endpoint EMR actually
// reaches; it was previously wide open (issue #148).
router.post('/emr', verifyEmrWebhook, handleEmrWebhook);

export default router;

import { db } from "@workspace/db";
import { emailTemplatesTable, discountTiersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_WELCOME_SUBJECT = "Welcome to HR Analytics Summit 2026 — We Can't Wait to See You!";

const DEFAULT_WELCOME_BODY = `
<h2>Welcome, {{firstName}}!</h2>

<p>We're absolutely thrilled to have you joining us at the <strong>HR Analytics Summit 2026</strong> — the UK's leading event for HR leaders, people analytics practitioners, and business innovators who are shaping the future of work.</p>

<p>Here's what to look forward to on <strong>3 September 2026</strong> at <strong>155 Bishopsgate, London</strong>:</p>

<ul>
  <li><strong>Inspiring keynotes</strong> from world-class HR and analytics leaders</li>
  <li><strong>Practical breakout sessions</strong> covering the latest in people data, AI in HR, and workforce planning</li>
  <li><strong>Networking opportunities</strong> throughout the day — meet your peers, discover new solutions</li>
  <li><strong>Happy Hour with entertainment</strong> to close out the day</li>
  <li><strong>Award-winning food & drink</strong> served throughout</li>
</ul>

<div class="info-box">
  <strong>Event Details</strong><br>
  <strong>Date:</strong> Thursday, 3 September 2026<br>
  <strong>Venue:</strong> 155 Bishopsgate, London EC2M 3TQ<br>
  <strong>Registration:</strong> From 8:30am<br>
  <strong>Event Opens:</strong> 9:00am
</div>

<p>Your conference pass and receipt are included in the accompanying email. Please bring a digital or printed copy for check-in.</p>

<div style="background: #fff8f7; border: 2px solid #E74F3E; border-radius: 6px; padding: 20px; margin: 24px 0;">
  <p style="margin: 0 0 12px; font-weight: 700; color: #E74F3E; font-size: 15px;">📋 Manage Your Attendee Details Online</p>
  <p style="margin: 0 0 12px; color: #444; line-height: 1.6;">You have access to a secure self-service link where you can fill in or update attendee details at any time — <strong>no login required</strong>. You can:</p>
  <ul style="margin: 0 0 12px; padding-left: 20px; color: #444; line-height: 1.8;">
    <li>Fill in details for any placeholder (TBC) attendee seats</li>
    <li>Update names, job titles, companies, and email addresses</li>
    <li>Add dietary or accessibility requirements</li>
    <li>Forward the link to colleagues so they can enter their own details directly</li>
  </ul>
  <p style="margin: 0; color: #666; font-size: 14px;"><em>Your unique management link is included in the accompanying booking confirmation email — look for the red "Manage Attendees" section.</em></p>
</div>

<p>If you have any questions before the event, please don't hesitate to reach out to us at <a href="mailto:info@hranalyticssummit.com">info@hranalyticssummit.com</a>.</p>

<p>We look forward to seeing you there!</p>

<p>Warm regards,<br>
<strong>The HR Analytics Summit Team</strong></p>
`;

const DEFAULT_DISCOUNT_TIERS = [
  { passType: "single" as const, minQuantity: 4, discountPercent: "10", label: "4+ passes" },
  { passType: "single" as const, minQuantity: 8, discountPercent: "15", label: "8+ passes" },
  { passType: "single" as const, minQuantity: 12, discountPercent: "20", label: "12+ passes" },
  { passType: "business" as const, minQuantity: 2, discountPercent: "10", label: "2+ Business Passes" },
  { passType: "business" as const, minQuantity: 5, discountPercent: "15", label: "5+ Business Passes" },
];

export async function seed() {
  try {
    const existing = await db
      .select()
      .from(emailTemplatesTable)
      .where(eq(emailTemplatesTable.type, "welcome"));

    if (existing.length === 0) {
      await db.insert(emailTemplatesTable).values({
        type: "welcome",
        subject: DEFAULT_WELCOME_SUBJECT,
        htmlBody: DEFAULT_WELCOME_BODY,
      });
      logger.info("Seeded welcome email template");
    } else {
      // Update existing template with latest content
      await db
        .update(emailTemplatesTable)
        .set({
          subject: DEFAULT_WELCOME_SUBJECT,
          htmlBody: DEFAULT_WELCOME_BODY,
        })
        .where(eq(emailTemplatesTable.type, "welcome"));
      logger.info("Updated welcome email template");
    }

    const existingTiers = await db.select().from(discountTiersTable);
    if (existingTiers.length === 0) {
      await db.insert(discountTiersTable).values(DEFAULT_DISCOUNT_TIERS);
      logger.info("Seeded default discount tiers");
    }
  } catch (err) {
    logger.error({ err }, "Seed failed");
  }
}

CREATE TABLE `billing_rates` (
	`month` text PRIMARY KEY NOT NULL,
	`amount` integer NOT NULL,
	CONSTRAINT "rate_amount" CHECK("billing_rates"."amount" BETWEEN 0 AND 100000)
);

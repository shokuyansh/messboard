CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`type` text NOT NULL,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activity_student` ON `activity` (`student_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`student_id` text NOT NULL,
	`meal_date` text NOT NULL,
	`meal` integer NOT NULL,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`student_id`, `meal_date`, `meal`),
	FOREIGN KEY (`student_id`,`meal_date`,`meal`) REFERENCES `bookings`(`student_id`,`meal_date`,`meal`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attendance_date` ON `attendance` (`meal_date`);--> statement-breakpoint
CREATE TABLE `bills` (
	`student_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`paid_at` text,
	`receipt` text,
	PRIMARY KEY(`student_id`, `month`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_amount" CHECK("bills"."amount" BETWEEN 0 AND 100000),
	CONSTRAINT "bill_status" CHECK("bills"."status" IN ('pending','simulated_paid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_receipt` ON `bills` (`receipt`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`student_id` text NOT NULL,
	`meal_date` text NOT NULL,
	`meal` integer NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`student_id`, `meal_date`, `meal`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "booking_meal" CHECK("bookings"."meal" BETWEEN 0 AND 2),
	CONSTRAINT "booking_status" CHECK("bookings"."status" IN ('booked','skipped'))
);
--> statement-breakpoint
CREATE INDEX `bookings_date` ON `bookings` (`meal_date`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`category` text NOT NULL,
	`rating` integer NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "feedback_rating" CHECK("feedback"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "feedback_status" CHECK("feedback"."status" IN ('open','reviewed'))
);
--> statement-breakpoint
CREATE INDEX `feedback_student` ON `feedback` (`student_id`);--> statement-breakpoint
CREATE TABLE `menus` (
	`weekday` integer NOT NULL,
	`meal` integer NOT NULL,
	`description` text NOT NULL,
	`diet` text DEFAULT 'Vegetarian' NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`weekday`, `meal`),
	CONSTRAINT "menu_weekday" CHECK("menus"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "menu_meal" CHECK("menus"."meal" BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`roll` text,
	`hostel` text DEFAULT 'Hostel A' NOT NULL,
	`role` text DEFAULT 'student' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "student_role" CHECK("students"."role" IN ('student','admin')),
	CONSTRAINT "student_active" CHECK("students"."active" IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_roll_unique` ON `students` (`roll`);
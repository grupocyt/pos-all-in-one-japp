// ⚠️ GENERADO con `npm run db:pull` desde la base de japp-db. No editar a mano.
import { pgTable, index, foreignKey, unique, check, uuid, varchar, boolean, timestamp, smallint, numeric, jsonb, integer, date, text, bigint, primaryKey, char } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
const TS = (name: string) => timestamp(name, { precision: 3, withTimezone: true, mode: 'string' });



export const appUser = pgTable("app_user", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 60 }).notNull(),
	initials: varchar({ length: 4 }),
	profileId: uuid("profile_id").notNull(),
	pinHash: varchar("pin_hash", { length: 100 }).notNull(),
	canCharge: boolean("can_charge"),
	canDeletePrinted: boolean("can_delete_printed"),
	canDeletePrebill: boolean("can_delete_prebill"),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lockSeconds: smallint("lock_seconds"),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_app_user_profile_id").using("btree", table.profileId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [userProfile.id],
			name: "app_user_profile_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "app_user_store_id_fkey"
		}),
	unique("uq_app_user_store_id_name").on(table.storeId, table.name),
	check("ck_app_user_lock_seconds", sql`(lock_seconds IS NULL) OR ((lock_seconds >= 0) AND (lock_seconds <= 3600))`),
]);

export const cashMovement = pgTable("cash_movement", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	periodId: uuid("period_id").notNull(),
	stationId: uuid("station_id"),
	kind: varchar({ length: 30 }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	reasonId: uuid("reason_id"),
	note: varchar({ length: 200 }),
	countedDetail: jsonb("counted_detail"),
	byUserId: uuid("by_user_id"),
	byUserName: varchar("by_user_name", { length: 60 }).notNull(),
	byRole: varchar("by_role", { length: 30 }),
	byDevice: varchar("by_device", { length: 40 }),
	byAt: timestamp("by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	authorizedBy: varchar("authorized_by", { length: 60 }),
}, (table) => [
	index("ix_cash_movement_by_user_id").using("btree", table.byUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_cash_movement_period_id").using("btree", table.periodId.asc().nullsLast().op("uuid_ops")),
	index("ix_cash_movement_reason_id").using("btree", table.reasonId.asc().nullsLast().op("uuid_ops")),
	index("ix_cash_movement_station_id").using("btree", table.stationId.asc().nullsLast().op("uuid_ops")),
	index("ix_cash_movement_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.byUserId],
			foreignColumns: [appUser.id],
			name: "cash_movement_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.periodId],
			foreignColumns: [salesPeriod.id],
			name: "cash_movement_period_id_fkey"
		}),
	foreignKey({
			columns: [table.reasonId],
			foreignColumns: [reason.id],
			name: "cash_movement_reason_id_fkey"
		}),
	foreignKey({
			columns: [table.stationId],
			foreignColumns: [station.id],
			name: "cash_movement_station_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "cash_movement_store_id_fkey"
		}),
	check("cash_movement_by_role_check", sql`(by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("cash_movement_kind_check", sql`(kind)::text = ANY (ARRAY[('float'::character varying)::text, ('withdrawal'::character varying)::text, ('count'::character varying)::text, ('deposit'::character varying)::text])`),
]);

export const areaDrawing = pgTable("area_drawing", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	areaId: uuid("area_id").notNull(),
	kind: varchar({ length: 30 }).notNull(),
	x1: numeric({ precision: 7, scale:  2 }).notNull(),
	y1: numeric({ precision: 7, scale:  2 }).notNull(),
	x2: numeric({ precision: 7, scale:  2 }),
	y2: numeric({ precision: 7, scale:  2 }),
	item: varchar({ length: 20 }),
	label: varchar({ length: 80 }),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	index("ix_area_drawing_area_id").using("btree", table.areaId.asc().nullsLast().op("uuid_ops")),
	index("ix_area_drawing_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.areaId],
			foreignColumns: [area.id],
			name: "area_drawing_area_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "area_drawing_store_id_fkey"
		}),
	check("area_drawing_kind_check", sql`(kind)::text = ANY (ARRAY[('wall'::character varying)::text, ('block'::character varying)::text, ('item'::character varying)::text, ('text'::character varying)::text])`),
]);

export const billingSettings = pgTable("billing_settings", {
	storeId: uuid("store_id").primaryKey().notNull(),
	billingEmail: varchar("billing_email", { length: 120 }),
	establishment: varchar({ length: 10 }),
	emissionPoint: varchar("emission_point", { length: 10 }),
	seriesSimplified: varchar("series_simplified", { length: 20 }).notNull(),
	seriesFull: varchar("series_full", { length: 20 }).notNull(),
	seriesCredit: varchar("series_credit", { length: 20 }).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "billing_settings_store_id_fkey"
		}).onDelete("cascade"),
]);

export const cashClosing = pgTable("cash_closing", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	periodId: uuid("period_id").notNull(),
	countedCash: numeric("counted_cash", { precision: 10, scale:  2 }).notNull(),
	countedCard: numeric("counted_card", { precision: 10, scale:  2 }),
	expectedCash: numeric("expected_cash", { precision: 10, scale:  2 }).notNull(),
	difference: numeric({ precision: 10, scale:  2 }).notNull(),
	nextFloat: numeric("next_float", { precision: 10, scale:  2 }).notNull(),
	deposit: numeric({ precision: 10, scale:  2 }).notNull(),
	grossSales: numeric("gross_sales", { precision: 10, scale:  2 }).notNull(),
	guests: integer(),
	byUserId: uuid("by_user_id"),
	byUserName: varchar("by_user_name", { length: 60 }).notNull(),
	byRole: varchar("by_role", { length: 30 }),
	byDevice: varchar("by_device", { length: 40 }),
	byAt: timestamp("by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	authorizedBy: varchar("authorized_by", { length: 60 }),
}, (table) => [
	index("ix_cash_closing_by_user_id").using("btree", table.byUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_cash_closing_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.byUserId],
			foreignColumns: [appUser.id],
			name: "cash_closing_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.periodId],
			foreignColumns: [salesPeriod.id],
			name: "cash_closing_period_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "cash_closing_store_id_fkey"
		}),
	unique("uq_cash_closing_period_id").on(table.periodId),
	check("cash_closing_by_role_check", sql`(by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
]);

export const customerRef = pgTable("customer_ref", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	type: varchar({ length: 30 }).notNull(),
	taxId: varchar("tax_id", { length: 20 }).notNull(),
	name: varchar({ length: 120 }).notNull(),
	email: varchar({ length: 120 }),
	phone: varchar({ length: 30 }),
	street: varchar({ length: 200 }),
	postalCode: varchar("postal_code", { length: 10 }),
	city: varchar({ length: 80 }),
	province: varchar({ length: 80 }),
	country: varchar({ length: 2 }).default('ES'),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "customer_ref_store_id_fkey"
		}),
	unique("uq_customer_ref_store_id_tax_id").on(table.storeId, table.taxId),
	check("customer_ref_type_check", sql`(type)::text = ANY (ARRAY[('person'::character varying)::text, ('company'::character varying)::text])`),
]);

export const diningTable = pgTable("dining_table", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	areaId: uuid("area_id").notNull(),
	number: varchar({ length: 10 }).notNull(),
	capacity: smallint().default(4).notNull(),
	posX: numeric("pos_x", { precision: 7, scale:  2 }),
	posY: numeric("pos_y", { precision: 7, scale:  2 }),
	width: smallint().default(110),
	height: smallint().default(90),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_dining_table_area_id").using("btree", table.areaId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.areaId],
			foreignColumns: [area.id],
			name: "dining_table_area_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "dining_table_store_id_fkey"
		}),
	unique("uq_dining_table_store_id_number").on(table.storeId, table.number),
]);

export const incidentRequest = pgTable("incident_request", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	code: varchar({ length: 30 }).notNull(),
	triggerKind: varchar("trigger_kind", { length: 30 }).notNull(),
	sentAt: timestamp("sent_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	sentBy: varchar("sent_by", { length: 60 }),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "incident_request_store_id_fkey"
		}),
	unique("uq_incident_request_store_id_code").on(table.storeId, table.code),
	check("incident_request_trigger_kind_check", sql`(trigger_kind)::text = ANY (ARRAY[('period_close'::character varying)::text, ('manual'::character varying)::text])`),
]);

export const invoice = pgTable("invoice", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	accountId: uuid("account_id"),
	orderId: uuid("order_id"),
	type: varchar({ length: 30 }).notNull(),
	series: varchar({ length: 20 }).notNull(),
	sequence: integer().notNull(),
	invoiceNumber: varchar("invoice_number", { length: 40 }).notNull(),
	issuedAt: timestamp("issued_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	issuerTaxId: varchar("issuer_tax_id", { length: 20 }).notNull(),
	issuerName: varchar("issuer_name", { length: 120 }).notNull(),
	customerId: uuid("customer_id"),
	customerType: varchar("customer_type", { length: 30 }),
	customerTaxId: varchar("customer_tax_id", { length: 20 }),
	customerName: varchar("customer_name", { length: 120 }),
	customerEmail: varchar("customer_email", { length: 120 }),
	customerPhone: varchar("customer_phone", { length: 30 }),
	customerStreet: varchar("customer_street", { length: 200 }),
	customerPostalCode: varchar("customer_postal_code", { length: 10 }),
	customerCity: varchar("customer_city", { length: 80 }),
	customerProvince: varchar("customer_province", { length: 80 }),
	customerCountry: varchar("customer_country", { length: 2 }),
	taxBase: numeric("tax_base", { precision: 10, scale:  2 }).notNull(),
	taxTotal: numeric("tax_total", { precision: 10, scale:  2 }).notNull(),
	total: numeric({ precision: 10, scale:  2 }).notNull(),
	rectifiedInvoiceId: uuid("rectified_invoice_id"),
	rectificationReason: varchar("rectification_reason", { length: 200 }),
	verifactuQr: varchar("verifactu_qr", { length: 400 }),
	status: varchar({ length: 30 }).default('issued').notNull(),
	issuedByUserId: uuid("issued_by_user_id"),
	issuedByUserName: varchar("issued_by_user_name", { length: 60 }).notNull(),
	issuedByRole: varchar("issued_by_role", { length: 30 }),
	issuedByDevice: varchar("issued_by_device", { length: 40 }),
	issuedByAt: timestamp("issued_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_invoice_account_id").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("ix_invoice_customer_id").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	index("ix_invoice_issued_by_user_id").using("btree", table.issuedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_invoice_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("ix_invoice_rectified_invoice_id").using("btree", table.rectifiedInvoiceId.asc().nullsLast().op("uuid_ops")),
	index("ix_invoice_store_id_issued_at").using("btree", table.storeId.asc().nullsLast().op("timestamptz_ops"), table.issuedAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "invoice_account_id_fkey"
		}),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customerRef.id],
			name: "invoice_customer_id_fkey"
		}),
	foreignKey({
			columns: [table.issuedByUserId],
			foreignColumns: [appUser.id],
			name: "invoice_issued_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "invoice_order_id_fkey"
		}),
	foreignKey({
			columns: [table.rectifiedInvoiceId],
			foreignColumns: [table.id],
			name: "invoice_rectified_invoice_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "invoice_store_id_fkey"
		}),
	unique("uq_invoice_invoice_number_store_id").on(table.storeId, table.invoiceNumber),
	unique("uq_invoice_store_id_series_sequence").on(table.storeId, table.series, table.sequence),
	check("invoice_customer_type_check", sql`(customer_type)::text = ANY (ARRAY[('person'::character varying)::text, ('company'::character varying)::text])`),
	check("invoice_issued_by_role_check", sql`(issued_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("invoice_status_check", sql`(status)::text = ANY (ARRAY[('issued'::character varying)::text, ('rectified'::character varying)::text, ('cancelled'::character varying)::text])`),
	check("invoice_type_check", sql`(type)::text = ANY (ARRAY[('F1'::character varying)::text, ('F2'::character varying)::text, ('R1'::character varying)::text])`),
]);

export const orderLine = pgTable("order_line", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	orderId: uuid("order_id").notNull(),
	accountId: uuid("account_id").notNull(),
	productId: uuid("product_id"),
	plu: integer().notNull(),
	name: varchar({ length: 80 }).notNull(),
	comment: varchar({ length: 300 }),
	quantity: numeric({ precision: 9, scale:  3 }).default('1').notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale:  2 }).notNull(),
	taxRate: numeric("tax_rate", { precision: 5, scale:  2 }).notNull(),
	taxAmount: numeric("tax_amount", { precision: 12, scale:  4 }),
	netAmount: numeric("net_amount", { precision: 12, scale:  4 }),
	status: varchar({ length: 30 }).default('pendingPrint').notNull(),
	printed: boolean().default(false).notNull(),
	createdByUserId: uuid("created_by_user_id"),
	createdByUserName: varchar("created_by_user_name", { length: 60 }).notNull(),
	createdByRole: varchar("created_by_role", { length: 30 }),
	createdByDevice: varchar("created_by_device", { length: 40 }),
	createdByOrigin: varchar("created_by_origin", { length: 30 }),
	createdByAt: timestamp("created_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	sourceLineId: uuid("source_line_id"),
	sortOrder: integer("sort_order").default(0).notNull(),
	courses: jsonb(),
	deleted: boolean().default(false).notNull(),
	deleteReasonId: uuid("delete_reason_id"),
	deleteReason: varchar("delete_reason", { length: 80 }),
	deletedByUserId: uuid("deleted_by_user_id"),
	deletedByUserName: varchar("deleted_by_user_name", { length: 60 }),
	deletedByRole: varchar("deleted_by_role", { length: 30 }),
	deletedByDevice: varchar("deleted_by_device", { length: 40 }),
	deletedByAt: timestamp("deleted_by_at", { precision: 3, withTimezone: true, mode: 'string' }),
	deleteAuthorizedByUserId: uuid("delete_authorized_by_user_id"),
	deleteAuthorizedByUserName: varchar("delete_authorized_by_user_name", { length: 60 }),
	deleteAuthorizedByRole: varchar("delete_authorized_by_role", { length: 30 }),
	deleteAuthorizedByDevice: varchar("delete_authorized_by_device", { length: 40 }),
	deleteAuthorizedByAt: timestamp("delete_authorized_by_at", { precision: 3, withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedStage: varchar("deleted_stage", { length: 20 }),
}, (table) => [
	index("ix_order_line_account_id_deleted").using("btree", table.accountId.asc().nullsLast().op("bool_ops"), table.deleted.asc().nullsLast().op("bool_ops")),
	index("ix_order_line_created_by_user_id").using("btree", table.createdByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_delete_authorized_by_user_id").using("btree", table.deleteAuthorizedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_delete_reason_id").using("btree", table.deleteReasonId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_deleted_by_user_id").using("btree", table.deletedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_product_id").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_source_line_id").using("btree", table.sourceLineId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_store_id_plu").using("btree", table.storeId.asc().nullsLast().op("uuid_ops"), table.plu.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "order_line_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [appUser.id],
			name: "order_line_created_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.deleteAuthorizedByUserId],
			foreignColumns: [appUser.id],
			name: "order_line_delete_authorized_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.deleteReasonId],
			foreignColumns: [reason.id],
			name: "order_line_delete_reason_id_fkey"
		}),
	foreignKey({
			columns: [table.deletedByUserId],
			foreignColumns: [appUser.id],
			name: "order_line_deleted_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_line_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "order_line_product_id_fkey"
		}),
	foreignKey({
			columns: [table.sourceLineId],
			foreignColumns: [table.id],
			name: "order_line_source_line_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "order_line_store_id_fkey"
		}),
	check("order_line_created_by_origin_check", sql`(created_by_origin)::text = ANY (ARRAY[('tpv'::character varying)::text, ('pda'::character varying)::text, ('qr'::character varying)::text, ('api'::character varying)::text])`),
	check("order_line_created_by_role_check", sql`(created_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("order_line_delete_authorized_by_role_check", sql`(delete_authorized_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("order_line_deleted_by_role_check", sql`(deleted_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("order_line_status_check", sql`(status)::text = ANY (ARRAY[('pendingPrint'::character varying)::text, ('printed'::character varying)::text, ('preBill'::character varying)::text, ('deleted'::character varying)::text])`),
]);

export const orderLineModifier = pgTable("order_line_modifier", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	lineId: uuid("line_id").notNull(),
	questionId: uuid("question_id"),
	productId: uuid("product_id"),
	plu: integer(),
	course: smallint(),
	name: varchar({ length: 80 }).notNull(),
	quantity: numeric({ precision: 9, scale:  3 }).default('1').notNull(),
	unitPrice: numeric("unit_price", { precision: 10, scale:  2 }).default('0').notNull(),
	taxAmount: numeric("tax_amount", { precision: 12, scale:  4 }),
	netAmount: numeric("net_amount", { precision: 12, scale:  4 }),
}, (table) => [
	index("ix_order_line_modifier_line_id").using("btree", table.lineId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_modifier_product_id").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_modifier_question_id").using("btree", table.questionId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_modifier_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.lineId],
			foreignColumns: [orderLine.id],
			name: "order_line_modifier_line_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "order_line_modifier_product_id_fkey"
		}),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [question.id],
			name: "order_line_modifier_question_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "order_line_modifier_store_id_fkey"
		}),
]);

export const accountDiscount = pgTable("account_discount", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	accountId: uuid("account_id").notNull(),
	discountId: uuid("discount_id"),
	source: varchar({ length: 30 }).notNull(),
	couponId: varchar("coupon_id", { length: 40 }),
	couponCode: varchar("coupon_code", { length: 40 }),
	type: varchar({ length: 30 }).notNull(),
	value: numeric({ precision: 10, scale:  2 }).notNull(),
	baseAmount: numeric("base_amount", { precision: 10, scale:  2 }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	reason: varchar({ length: 120 }),
	status: varchar({ length: 30 }).default('applied').notNull(),
	appliedByUserId: uuid("applied_by_user_id"),
	appliedByUserName: varchar("applied_by_user_name", { length: 60 }).notNull(),
	appliedByRole: varchar("applied_by_role", { length: 30 }),
	appliedByDevice: varchar("applied_by_device", { length: 40 }),
	appliedByAt: timestamp("applied_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	authorizedByUserId: uuid("authorized_by_user_id"),
	authorizedByUserName: varchar("authorized_by_user_name", { length: 60 }),
	authorizedByRole: varchar("authorized_by_role", { length: 30 }),
	authorizedByDevice: varchar("authorized_by_device", { length: 40 }),
	authorizedByAt: timestamp("authorized_by_at", { precision: 3, withTimezone: true, mode: 'string' }),
	removedByUserId: uuid("removed_by_user_id"),
	removedByUserName: varchar("removed_by_user_name", { length: 60 }),
	removedByRole: varchar("removed_by_role", { length: 30 }),
	removedByDevice: varchar("removed_by_device", { length: 40 }),
	removedByAt: timestamp("removed_by_at", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_account_discount_account_id").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_discount_applied_by_user_id").using("btree", table.appliedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_discount_authorized_by_user_id").using("btree", table.authorizedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_discount_discount_id").using("btree", table.discountId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_discount_removed_by_user_id").using("btree", table.removedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_discount_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "account_discount_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.appliedByUserId],
			foreignColumns: [appUser.id],
			name: "account_discount_applied_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.authorizedByUserId],
			foreignColumns: [appUser.id],
			name: "account_discount_authorized_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.discountId],
			foreignColumns: [discount.id],
			name: "account_discount_discount_id_fkey"
		}),
	foreignKey({
			columns: [table.removedByUserId],
			foreignColumns: [appUser.id],
			name: "account_discount_removed_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "account_discount_store_id_fkey"
		}),
	check("account_discount_status_check", sql`(status)::text = ANY (ARRAY[('applied'::character varying)::text, ('removed'::character varying)::text])`),
	check("account_discount_applied_by_role_check", sql`(applied_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("account_discount_authorized_by_role_check", sql`(authorized_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("account_discount_removed_by_role_check", sql`(removed_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("account_discount_source_check", sql`(source)::text = ANY (ARRAY[('coupon'::character varying)::text, ('manual'::character varying)::text, ('promotion'::character varying)::text])`),
	check("account_discount_type_check", sql`(type)::text = ANY (ARRAY[('percentage'::character varying)::text, ('fixed'::character varying)::text])`),
]);

export const area = pgTable("area", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 60 }).notNull(),
	sortOrder: smallint("sort_order").default(1).notNull(),
	priceList: varchar("price_list", { length: 30 }).default('general').notNull(),
	tableNumberFrom: integer("table_number_from").default(1).notNull(),
	planWidth: smallint("plan_width").default(1000),
	planHeight: smallint("plan_height").default(640),
	planImageUrl: varchar("plan_image_url", { length: 300 }),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
	ticketChannelId: uuid("ticket_channel_id"),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "area_store_id_fkey"
		}),
	unique("uq_area_store_id_name").on(table.storeId, table.name),
	check("area_price_list_check", sql`(price_list)::text = ANY (ARRAY[('general'::character varying)::text, ('terrace'::character varying)::text])`),
]);

export const category = pgTable("category", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 60 }).notNull(),
	bgColor: varchar("bg_color", { length: 9 }),
	fgColor: varchar("fg_color", { length: 9 }),
	sortOrder: smallint("sort_order").default(0).notNull(),
	hidden: boolean().default(false).notNull(),
	maxpointId: varchar("maxpoint_id", { length: 40 }),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "category_store_id_fkey"
		}),
	unique("uq_category_store_id_name").on(table.storeId, table.name),
]);

export const company = pgTable("company", {
	id: uuid().primaryKey().notNull(),
	legalName: varchar("legal_name", { length: 120 }).notNull(),
	tradeName: varchar("trade_name", { length: 120 }),
	taxId: varchar("tax_id", { length: 20 }).notNull(),
	address: varchar({ length: 200 }),
	country: varchar({ length: 60 }),
	maxpointCdnId: integer("maxpoint_cdn_id"),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	unique("uq_company_tax_id").on(table.taxId),
]);

export const discount = pgTable("discount", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 60 }).notNull(),
	percent: numeric({ precision: 5, scale:  2 }).notNull(),
	validFrom: date("valid_from"),
	validTo: date("valid_to"),
	needsAuthorization: boolean("needs_authorization").default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_discount_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "discount_store_id_fkey"
		}),
]);

export const configChangeLog = pgTable("config_change_log", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	at: timestamp({ precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	userId: uuid("user_id"),
	userName: varchar("user_name", { length: 60 }).notNull(),
	module: varchar({ length: 30 }).notNull(),
	action: varchar({ length: 30 }).notNull(),
	recordName: varchar("record_name", { length: 120 }),
	diff: text(),
	syncedAt: timestamp("synced_at", { precision: 3, withTimezone: true, mode: 'string' }),
	recordId: varchar("record_id", { length: 40 }),
	before: jsonb(),
	after: jsonb(),
	configVersion: bigint("config_version", { mode: "number" }),
	device: varchar({ length: 40 }),
}, (table) => [
	index("ix_config_change_log_store_id_synced_at").using("btree", table.storeId.asc().nullsLast().op("timestamptz_ops"), table.syncedAt.asc().nullsLast().op("timestamptz_ops")),
	index("ix_config_change_log_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "config_change_log_store_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [appUser.id],
			name: "config_change_log_user_id_fkey"
		}),
	check("config_change_log_action_check", sql`(action)::text = ANY (ARRAY[('create'::character varying)::text, ('update'::character varying)::text, ('delete'::character varying)::text, ('activate'::character varying)::text, ('deactivate'::character varying)::text])`),
]);

export const orderEvent = pgTable("order_event", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	orderId: uuid("order_id").notNull(),
	accountId: uuid("account_id"),
	type: varchar({ length: 40 }).notNull(),
	at: timestamp({ precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	description: varchar({ length: 400 }),
	userId: uuid("user_id"),
	userName: varchar("user_name", { length: 60 }),
	role: varchar({ length: 30 }),
	device: varchar({ length: 40 }),
	origin: varchar({ length: 30 }),
}, (table) => [
	index("ix_order_event_account_id").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_event_order_id_at").using("btree", table.orderId.asc().nullsLast().op("timestamptz_ops"), table.at.asc().nullsLast().op("timestamptz_ops")),
	index("ix_order_event_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_event_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "order_event_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "order_event_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "order_event_store_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [appUser.id],
			name: "order_event_user_id_fkey"
		}),
	check("order_event_origin_check", sql`(origin)::text = ANY (ARRAY[('tpv'::character varying)::text, ('pda'::character varying)::text, ('qr'::character varying)::text, ('api'::character varying)::text])`),
	check("order_event_role_check", sql`(role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
]);

export const orderLinePrinter = pgTable("order_line_printer", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	lineId: uuid("line_id").notNull(),
	channelName: varchar("channel_name", { length: 40 }).notNull(),
	printerId: uuid("printer_id"),
	printerName: varchar("printer_name", { length: 40 }),
	interface: varchar({ length: 120 }),
	printed: boolean().default(false).notNull(),
	printedAt: timestamp("printed_at", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_order_line_printer_line_id").using("btree", table.lineId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_printer_printer_id").using("btree", table.printerId.asc().nullsLast().op("uuid_ops")),
	index("ix_order_line_printer_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.lineId],
			foreignColumns: [orderLine.id],
			name: "order_line_printer_line_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.printerId],
			foreignColumns: [printer.id],
			name: "order_line_printer_printer_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "order_line_printer_store_id_fkey"
		}),
]);

export const userProfile = pgTable("user_profile", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	code: varchar({ length: 30 }).notNull(),
	name: varchar({ length: 60 }).notNull(),
	level: smallint().default(10).notNull(),
	color: varchar({ length: 30 }),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
	allowedStations: varchar("allowed_stations", { length: 10 }).default('any').notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "user_profile_store_id_fkey"
		}),
	unique("uq_user_profile_store_id_code").on(table.storeId, table.code),
	check("user_profile_color_check", sql`(color)::text = ANY (ARRAY[('red'::character varying)::text, ('amber'::character varying)::text, ('green'::character varying)::text])`),
]);

export const paymentMethod = pgTable("payment_method", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	code: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 40 }).notNull(),
	kind: varchar({ length: 30 }).notNull(),
	opensDrawer: boolean("opens_drawer").default(false).notNull(),
	allowsTip: boolean("allows_tip").default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "payment_method_store_id_fkey"
		}),
	unique("uq_payment_method_store_id_code").on(table.storeId, table.code),
	check("payment_method_kind_check", sql`(kind)::text = ANY (ARRAY[('cash'::character varying)::text, ('card'::character varying)::text, ('platform'::character varying)::text, ('voucher'::character varying)::text])`),
]);

export const paymentBankData = pgTable("payment_bank_data", {
	paymentId: uuid("payment_id").primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	provider: varchar({ length: 40 }),
	merchantId: varchar("merchant_id", { length: 40 }),
	terminalId: varchar("terminal_id", { length: 40 }),
	transactionId: varchar("transaction_id", { length: 60 }),
	authorizationCode: varchar("authorization_code", { length: 20 }),
	responseCode: varchar("response_code", { length: 10 }),
	responseMessage: varchar("response_message", { length: 120 }),
	cardBrand: varchar("card_brand", { length: 20 }),
	maskedPan: varchar("masked_pan", { length: 30 }),
	entryMode: varchar("entry_mode", { length: 20 }),
	maskedPhone: varchar("masked_phone", { length: 30 }),
	amount: numeric({ precision: 10, scale:  2 }),
	currency: varchar({ length: 3 }),
	processedAt: timestamp("processed_at", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_payment_bank_data_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "payment_bank_data_payment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "payment_bank_data_store_id_fkey"
		}),
]);

export const printChannel = pgTable("print_channel", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 40 }).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
	kind: varchar({ length: 20 }).default("kitchen").notNull(),
	printerId: uuid("printer_id"),
	copyOfId: uuid("copy_of_id"),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "print_channel_store_id_fkey"
		}),
	unique("uq_print_channel_store_id_name").on(table.storeId, table.name),
]);

export const product = pgTable("product", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	plu: integer().notNull(),
	name: varchar({ length: 80 }).notNull(),
	ticketName: varchar("ticket_name", { length: 80 }),
	categoryId: uuid("category_id"),
	price: numeric({ precision: 10, scale:  2 }).notNull(),
	priceTerrace: numeric("price_terrace", { precision: 10, scale:  2 }),
	taxId: uuid("tax_id").notNull(),
	bgColor: varchar("bg_color", { length: 9 }),
	fgColor: varchar("fg_color", { length: 9 }),
	answerOnly: boolean("answer_only").default(false).notNull(),
	soldOut: boolean("sold_out").default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_product_category_id").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("ix_product_tax_id").using("btree", table.taxId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: "product_category_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "product_store_id_fkey"
		}),
	foreignKey({
			columns: [table.taxId],
			foreignColumns: [tax.id],
			name: "product_tax_id_fkey"
		}),
	unique("uq_product_store_id_plu").on(table.storeId, table.plu),
]);

export const station = pgTable("station", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 40 }).notNull(),
	kind: varchar({ length: 30 }).default('station').notNull(),
	deviceUuid: varchar("device_uuid", { length: 36 }),
	ip: varchar({ length: 45 }),
	emissionPoint: varchar("emission_point", { length: 10 }),
	opensDrawer: boolean("opens_drawer").default(false).notNull(),
	isMain: boolean("is_main").default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_station_device_uuid").using("btree", table.deviceUuid.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "station_store_id_fkey"
		}),
	unique("uq_station_store_id_name").on(table.storeId, table.name),
	check("station_kind_check", sql`(kind)::text = ANY (ARRAY[('station'::character varying)::text, ('pda'::character varying)::text])`),
]);

export const payment = pgTable("payment", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	accountId: uuid("account_id").notNull(),
	paymentMethodId: uuid("payment_method_id"),
	method: varchar({ length: 30 }).notNull(),
	amount: numeric({ precision: 10, scale:  2 }).notNull(),
	tip: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	cashGiven: numeric("cash_given", { precision: 10, scale:  2 }),
	changeGiven: numeric("change_given", { precision: 10, scale:  2 }),
	status: varchar({ length: 30 }).notNull(),
	stationId: uuid("station_id"),
	collectedByUserId: uuid("collected_by_user_id"),
	collectedByUserName: varchar("collected_by_user_name", { length: 60 }).notNull(),
	collectedByRole: varchar("collected_by_role", { length: 30 }),
	collectedByDevice: varchar("collected_by_device", { length: 40 }),
	collectedByAt: timestamp("collected_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("ix_payment_account_id").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("ix_payment_collected_by_user_id").using("btree", table.collectedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_payment_payment_method_id").using("btree", table.paymentMethodId.asc().nullsLast().op("uuid_ops")),
	index("ix_payment_station_id").using("btree", table.stationId.asc().nullsLast().op("uuid_ops")),
	index("ix_payment_store_id_collected_by_at").using("btree", table.storeId.asc().nullsLast().op("uuid_ops"), table.collectedByAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [account.id],
			name: "payment_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.collectedByUserId],
			foreignColumns: [appUser.id],
			name: "payment_collected_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.paymentMethodId],
			foreignColumns: [paymentMethod.id],
			name: "payment_payment_method_id_fkey"
		}),
	foreignKey({
			columns: [table.stationId],
			foreignColumns: [station.id],
			name: "payment_station_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "payment_store_id_fkey"
		}),
	check("payment_status_check", sql`(status)::text = ANY (ARRAY[('pending'::character varying)::text, ('confirmed'::character varying)::text, ('declined'::character varying)::text, ('refunded'::character varying)::text, ('cancelled'::character varying)::text])`),
	check("payment_collected_by_role_check", sql`(collected_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("ck_payment_method_code", sql`(method)::text ~ '^[a-z0-9_-]{1,30}$'::text`),
]);

export const storeParameters = pgTable("store_parameters", {
	storeId: uuid("store_id").primaryKey().notNull(),
	lockSeconds: smallint("lock_seconds").default(7).notNull(),
	lockSecondsPda: smallint("lock_seconds_pda").default(10).notNull(),
	duplicateMinutes: smallint("duplicate_minutes").default(3).notNull(),
	cashFloat: numeric("cash_float", { precision: 10, scale:  2 }).default('150').notNull(),
	cashDiffThreshold: numeric("cash_diff_threshold", { precision: 10, scale:  2 }).default('5').notNull(),
	idleTableMinutes: smallint("idle_table_minutes").default(45).notNull(),
	prebillToPayMinutes: smallint("prebill_to_pay_minutes").default(6).notNull(),
	kpiMinTables: smallint("kpi_min_tables").default(20).notNull(),
	pinAttempts: smallint("pin_attempts").default(3).notNull(),
	pinLockSeconds: smallint("pin_lock_seconds").default(30).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "store_parameters_store_id_fkey"
		}).onDelete("cascade"),
]);

export const verifactuRecord = pgTable("verifactu_record", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	invoiceId: uuid("invoice_id").notNull(),
	recordType: varchar("record_type", { length: 30 }).default('alta').notNull(),
	issuerTaxId: varchar("issuer_tax_id", { length: 20 }).notNull(),
	invoiceNumber: varchar("invoice_number", { length: 40 }).notNull(),
	issuedOn: date("issued_on").notNull(),
	invoiceType: varchar("invoice_type", { length: 30 }).notNull(),
	taxTotal: numeric("tax_total", { precision: 10, scale:  2 }).notNull(),
	total: numeric({ precision: 10, scale:  2 }).notNull(),
	previousRecordId: uuid("previous_record_id"),
	previousHash: varchar("previous_hash", { length: 64 }),
	hash: varchar({ length: 64 }).notNull(),
	generatedAt: timestamp("generated_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	status: varchar({ length: 30 }).default('pending').notNull(),
	aeatCsv: varchar("aeat_csv", { length: 40 }),
	aeatResponse: text("aeat_response"),
	sentAt: timestamp("sent_at", { precision: 3, withTimezone: true, mode: 'string' }),
	attempts: smallint().default(0).notNull(),
}, (table) => [
	index("ix_verifactu_record_invoice_id").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("ix_verifactu_record_issuer_tax_id_generated_at").using("btree", table.issuerTaxId.asc().nullsLast().op("timestamptz_ops"), table.generatedAt.asc().nullsLast().op("text_ops")),
	index("ix_verifactu_record_previous_record_id").using("btree", table.previousRecordId.asc().nullsLast().op("uuid_ops")),
	index("ix_verifactu_record_store_id_status").using("btree", table.storeId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoice.id],
			name: "verifactu_record_invoice_id_fkey"
		}),
	foreignKey({
			columns: [table.previousRecordId],
			foreignColumns: [table.id],
			name: "verifactu_record_previous_record_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "verifactu_record_store_id_fkey"
		}),
	unique("uq_verifactu_record_issuer_tax_id_invoice_number_record_type").on(table.recordType, table.issuerTaxId, table.invoiceNumber),
	unique("uq_verifactu_record_hash").on(table.hash),
	check("verifactu_record_invoice_type_check", sql`(invoice_type)::text = ANY (ARRAY[('F1'::character varying)::text, ('F2'::character varying)::text, ('R1'::character varying)::text])`),
	check("verifactu_record_record_type_check", sql`(record_type)::text = ANY (ARRAY[('alta'::character varying)::text, ('anulacion'::character varying)::text])`),
	check("verifactu_record_status_check", sql`(status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sent'::character varying)::text, ('accepted'::character varying)::text, ('accepted_with_errors'::character varying)::text, ('rejected'::character varying)::text])`),
]);

export const salesPeriod = pgTable("sales_period", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	status: varchar({ length: 30 }).default('open').notNull(),
	openedByUserId: uuid("opened_by_user_id"),
	openedByUserName: varchar("opened_by_user_name", { length: 60 }).notNull(),
	openedByRole: varchar("opened_by_role", { length: 30 }),
	openedByDevice: varchar("opened_by_device", { length: 40 }),
	openedByAt: timestamp("opened_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	stationId: uuid("station_id"),
	closedByUserId: uuid("closed_by_user_id"),
	closedByUserName: varchar("closed_by_user_name", { length: 60 }),
	closedByRole: varchar("closed_by_role", { length: 30 }),
	closedByDevice: varchar("closed_by_device", { length: 40 }),
	closedByAt: timestamp("closed_by_at", { precision: 3, withTimezone: true, mode: 'string' }),
	openFlag: smallint("open_flag"),
}, (table) => [
	index("ix_sales_period_closed_by_user_id").using("btree", table.closedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_sales_period_opened_by_user_id").using("btree", table.openedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_sales_period_station_id").using("btree", table.stationId.asc().nullsLast().op("uuid_ops")),
	index("ix_sales_period_store_id_opened_by_at").using("btree", table.storeId.asc().nullsLast().op("uuid_ops"), table.openedByAt.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.closedByUserId],
			foreignColumns: [appUser.id],
			name: "sales_period_closed_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.openedByUserId],
			foreignColumns: [appUser.id],
			name: "sales_period_opened_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.stationId],
			foreignColumns: [station.id],
			name: "sales_period_station_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "sales_period_store_id_fkey"
		}),
	unique("uq_sales_period_store_id_open_flag").on(table.storeId, table.openFlag),
	check("sales_period_closed_by_role_check", sql`(closed_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("sales_period_open_flag_check", sql`open_flag = 1`),
	check("sales_period_opened_by_role_check", sql`(opened_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("sales_period_status_check", sql`(status)::text = ANY (ARRAY[('open'::character varying)::text, ('closed'::character varying)::text])`),
]);

export const printer = pgTable("printer", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 40 }).notNull(),
	connection: varchar({ length: 120 }).notNull(),
	model: varchar({ length: 30 }).default('EPSON').notNull(),
	kind: varchar({ length: 30 }).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "printer_store_id_fkey"
		}),
	unique("uq_printer_store_id_name").on(table.storeId, table.name),
	check("printer_kind_check", sql`(kind)::text = ANY (ARRAY[('ticket'::character varying)::text, ('kitchen'::character varying)::text, ('bar'::character varying)::text])`),
	check("printer_model_check", sql`(model)::text = ANY (ARRAY[('EPSON'::character varying)::text, ('BIXOLON'::character varying)::text, ('POSIFLEX'::character varying)::text, ('VCOCINA'::character varying)::text])`),
]);

export const question = pgTable("question", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	minAnswers: smallint("min_answers").default(0).notNull(),
	maxAnswers: smallint("max_answers").default(1).notNull(),
	course: smallint(),
	maxpointId: varchar("maxpoint_id", { length: 40 }),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_question_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "question_store_id_fkey"
		}),
]);

export const reason = pgTable("reason", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 80 }).notNull(),
	kind: varchar({ length: 30 }).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	index("ix_reason_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "reason_store_id_fkey"
		}),
	check("reason_kind_check", sql`(kind)::text = ANY (ARRAY[('delete'::character varying)::text, ('withdrawal'::character varying)::text, ('credit'::character varying)::text])`),
]);

export const store = pgTable("store", {
	id: uuid().primaryKey().notNull(),
	companyId: uuid("company_id").notNull(),
	code: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 120 }).notNull(),
	serviceType: varchar("service_type", { length: 30 }).default('table').notNull(),
	address: varchar({ length: 200 }),
	city: varchar({ length: 80 }),
	phone: varchar({ length: 30 }),
	openingHours: varchar("opening_hours", { length: 60 }),
	reviewsUrl: varchar("reviews_url", { length: 300 }),
	logoUrl: varchar("logo_url", { length: 300 }),
	ticketHeader: text("ticket_header"),
	ticketFooter: text("ticket_footer"),
	maxpointRstId: integer("maxpoint_rst_id"),
	serverUrl: varchar("server_url", { length: 200 }),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
	configVersion: bigint("config_version", { mode: "number" }).default(1).notNull(),
}, (table) => [
	index("ix_store_company_id").using("btree", table.companyId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.companyId],
			foreignColumns: [company.id],
			name: "store_company_id_fkey"
		}),
	unique("uq_store_code").on(table.code),
	check("store_service_type_check", sql`(service_type)::text = ANY (ARRAY[('table'::character varying)::text, ('fastfood'::character varying)::text])`),
]);

export const paymentCashDetail = pgTable("payment_cash_detail", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	paymentId: uuid("payment_id").notNull(),
	direction: varchar({ length: 30 }).notNull(),
	kind: varchar({ length: 30 }).notNull(),
	value: numeric({ precision: 10, scale:  2 }).notNull(),
	quantity: smallint().notNull(),
}, (table) => [
	index("ix_payment_cash_detail_payment_id").using("btree", table.paymentId.asc().nullsLast().op("uuid_ops")),
	index("ix_payment_cash_detail_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "payment_cash_detail_payment_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "payment_cash_detail_store_id_fkey"
		}),
	check("payment_cash_detail_direction_check", sql`(direction)::text = ANY (ARRAY[('received'::character varying)::text, ('returned'::character varying)::text])`),
	check("payment_cash_detail_kind_check", sql`(kind)::text = ANY (ARRAY[('bill'::character varying)::text, ('coin'::character varying)::text])`),
]);

export const productIncident = pgTable("product_incident", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	code: varchar({ length: 20 }).notNull(),
	at: timestamp({ precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	userName: varchar("user_name", { length: 60 }).notNull(),
	productId: uuid("product_id"),
	productName: varchar("product_name", { length: 80 }),
	action: varchar({ length: 20 }).notNull(),
	diff: text(),
	status: varchar({ length: 30 }).default('pending').notNull(),
	requestId: uuid("request_id"),
}, (table) => [
	index("ix_product_incident_product_id").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("ix_product_incident_request_id").using("btree", table.requestId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "product_incident_product_id_fkey"
		}),
	foreignKey({
			columns: [table.requestId],
			foreignColumns: [incidentRequest.id],
			name: "product_incident_request_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "product_incident_store_id_fkey"
		}),
	unique("uq_product_incident_store_id_code").on(table.storeId, table.code),
	check("product_incident_status_check", sql`(status)::text = ANY (ARRAY[('pending'::character varying)::text, ('sent'::character varying)::text])`),
]);

export const permission = pgTable("permission", {
	code: varchar({ length: 40 }).primaryKey().notNull(),
	module: varchar({ length: 30 }).notNull(),
	name: varchar({ length: 80 }).notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
});

export const questionAnswer = pgTable("question_answer", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	questionId: uuid("question_id").notNull(),
	productId: uuid("product_id").notNull(),
	label: varchar({ length: 80 }),
	extraPrice: numeric("extra_price", { precision: 10, scale:  2 }).default('0').notNull(),
	bgColor: varchar("bg_color", { length: 9 }),
	fgColor: varchar("fg_color", { length: 9 }),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	index("ix_question_answer_product_id").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("ix_question_answer_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "question_answer_product_id_fkey"
		}),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [question.id],
			name: "question_answer_question_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "question_answer_store_id_fkey"
		}),
	unique("uq_question_answer_question_id_product_id").on(table.questionId, table.productId),
]);

export const syncOutbox = pgTable("sync_outbox", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity({ name: "sync_outbox_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	storeId: uuid("store_id").notNull(),
	entity: varchar({ length: 40 }).notNull(),
	entityId: uuid("entity_id").notNull(),
	operation: varchar({ length: 30 }).default('upsert').notNull(),
	payload: jsonb().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	sentAt: timestamp("sent_at", { precision: 3, withTimezone: true, mode: 'string' }),
	attempts: smallint().default(0).notNull(),
	lastError: varchar("last_error", { length: 300 }),
	eventId: uuid("event_id").defaultRandom().notNull(),
	parkedAt: timestamp("parked_at", { precision: 3, withTimezone: true, mode: 'string' }),
}, (table) => [
	index("ix_sync_outbox_sent_at_id").using("btree", table.sentAt.asc().nullsLast().op("int8_ops"), table.id.asc().nullsLast().op("int8_ops")),
	index("ix_sync_outbox_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "sync_outbox_store_id_fkey"
		}),
	check("sync_outbox_operation_check", sql`(operation)::text = ANY (ARRAY[('upsert'::character varying)::text, ('delete'::character varying)::text])`),
]);

export const account = pgTable("account", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	orderId: uuid("order_id").notNull(),
	name: varchar({ length: 40 }).notNull(),
	status: varchar({ length: 30 }).default('open').notNull(),
	note: varchar({ length: 300 }),
	openedByUserId: uuid("opened_by_user_id"),
	openedByUserName: varchar("opened_by_user_name", { length: 60 }).notNull(),
	openedByRole: varchar("opened_by_role", { length: 30 }),
	openedByDevice: varchar("opened_by_device", { length: 40 }),
	openedByAt: timestamp("opened_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	closedByUserId: uuid("closed_by_user_id"),
	closedByUserName: varchar("closed_by_user_name", { length: 60 }),
	closedByRole: varchar("closed_by_role", { length: 30 }),
	closedByDevice: varchar("closed_by_device", { length: 40 }),
	closedByAt: timestamp("closed_by_at", { precision: 3, withTimezone: true, mode: 'string' }),
	lastEntryUserId: uuid("last_entry_user_id"),
	lastEntryUserName: varchar("last_entry_user_name", { length: 60 }),
	lastEntryRole: varchar("last_entry_role", { length: 30 }),
	lastEntryDevice: varchar("last_entry_device", { length: 40 }),
	lastEntryAt: timestamp("last_entry_at", { precision: 3, withTimezone: true, mode: 'string' }),
	customerId: uuid("customer_id"),
	subtotal: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	discountTotal: numeric("discount_total", { precision: 10, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	paid: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	pending: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	tips: numeric({ precision: 10, scale:  2 }).default('0').notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_account_closed_by_user_id").using("btree", table.closedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_customer_id").using("btree", table.customerId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_last_entry_user_id").using("btree", table.lastEntryUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_opened_by_user_id").using("btree", table.openedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_order_id").using("btree", table.orderId.asc().nullsLast().op("uuid_ops")),
	index("ix_account_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.closedByUserId],
			foreignColumns: [appUser.id],
			name: "account_closed_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customerRef.id],
			name: "account_customer_id_fkey"
		}),
	foreignKey({
			columns: [table.lastEntryUserId],
			foreignColumns: [appUser.id],
			name: "account_last_entry_user_id_fkey"
		}),
	foreignKey({
			columns: [table.openedByUserId],
			foreignColumns: [appUser.id],
			name: "account_opened_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [orders.id],
			name: "account_order_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "account_store_id_fkey"
		}),
	check("account_closed_by_role_check", sql`(closed_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("account_last_entry_role_check", sql`(last_entry_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("account_opened_by_role_check", sql`(opened_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("account_status_check", sql`(status)::text = ANY (ARRAY[('open'::character varying)::text, ('billing'::character varying)::text, ('paid'::character varying)::text, ('invoiced'::character varying)::text, ('cancelled'::character varying)::text])`),
]);

export const orders = pgTable("orders", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	periodId: uuid("period_id"),
	status: varchar({ length: 30 }).default('open').notNull(),
	version: integer().default(1).notNull(),
	tableId: uuid("table_id"),
	tableName: varchar("table_name", { length: 20 }).notNull(),
	zone: varchar({ length: 60 }),
	priceList: varchar("price_list", { length: 30 }).default('general').notNull(),
	guests: smallint().default(1).notNull(),
	note: varchar({ length: 300 }),
	openedByUserId: uuid("opened_by_user_id"),
	openedByUserName: varchar("opened_by_user_name", { length: 60 }).notNull(),
	openedByRole: varchar("opened_by_role", { length: 30 }),
	openedByDevice: varchar("opened_by_device", { length: 40 }),
	openedByAt: timestamp("opened_by_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	lastEntryUserId: uuid("last_entry_user_id"),
	lastEntryUserName: varchar("last_entry_user_name", { length: 60 }),
	lastEntryRole: varchar("last_entry_role", { length: 30 }),
	lastEntryDevice: varchar("last_entry_device", { length: 40 }),
	lastEntryAt: timestamp("last_entry_at", { precision: 3, withTimezone: true, mode: 'string' }),
	lastExitUserId: uuid("last_exit_user_id"),
	lastExitUserName: varchar("last_exit_user_name", { length: 60 }),
	lastExitRole: varchar("last_exit_role", { length: 30 }),
	lastExitDevice: varchar("last_exit_device", { length: 40 }),
	lastExitAt: timestamp("last_exit_at", { precision: 3, withTimezone: true, mode: 'string' }),
	closedAt: timestamp("closed_at", { precision: 3, withTimezone: true, mode: 'string' }),
	snapshot: jsonb(),
	holderUserId: uuid("holder_user_id"),
	holderUserName: varchar("holder_user_name", { length: 80 }),
	holderStationId: uuid("holder_station_id"),
	holderStationName: varchar("holder_station_name", { length: 60 }),
	holderUntil: timestamp("holder_until", { precision: 3, withTimezone: true, mode: 'string' }),
	chargingUntil: timestamp("charging_until", { precision: 3, withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_orders_last_entry_user_id").using("btree", table.lastEntryUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_orders_last_exit_user_id").using("btree", table.lastExitUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_orders_opened_by_user_id").using("btree", table.openedByUserId.asc().nullsLast().op("uuid_ops")),
	index("ix_orders_period_id").using("btree", table.periodId.asc().nullsLast().op("uuid_ops")),
	index("ix_orders_store_id_status").using("btree", table.storeId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	index("ix_orders_table_id_status").using("btree", table.tableId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.lastEntryUserId],
			foreignColumns: [appUser.id],
			name: "orders_last_entry_user_id_fkey"
		}),
	foreignKey({
			columns: [table.lastExitUserId],
			foreignColumns: [appUser.id],
			name: "orders_last_exit_user_id_fkey"
		}),
	foreignKey({
			columns: [table.openedByUserId],
			foreignColumns: [appUser.id],
			name: "orders_opened_by_user_id_fkey"
		}),
	foreignKey({
			columns: [table.periodId],
			foreignColumns: [salesPeriod.id],
			name: "orders_period_id_fkey"
		}),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "orders_store_id_fkey"
		}),
	foreignKey({
			columns: [table.tableId],
			foreignColumns: [diningTable.id],
			name: "orders_table_id_fkey"
		}),
	check("orders_last_entry_role_check", sql`(last_entry_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("orders_last_exit_role_check", sql`(last_exit_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("orders_opened_by_role_check", sql`(opened_by_role)::text = ANY (ARRAY[('waiter'::character varying)::text, ('cashier'::character varying)::text, ('manager'::character varying)::text, ('customer'::character varying)::text, ('system'::character varying)::text])`),
	check("orders_price_list_check", sql`(price_list)::text = ANY (ARRAY[('general'::character varying)::text, ('terrace'::character varying)::text])`),
	check("orders_status_check", sql`(status)::text = ANY (ARRAY[('open'::character varying)::text, ('billing'::character varying)::text, ('closed'::character varying)::text, ('cancelled'::character varying)::text])`),
]);

export const tax = pgTable("tax", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	name: varchar({ length: 30 }).notNull(),
	rate: numeric({ precision: 5, scale:  2 }).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	version: integer().default(1).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "tax_store_id_fkey"
		}),
	unique("uq_tax_store_id_name_rate").on(table.storeId, table.name, table.rate),
]);

export const productChannel = pgTable("product_channel", {
	productId: uuid("product_id").notNull(),
	channelId: uuid("channel_id").notNull(),
	storeId: uuid("store_id").notNull(),
}, (table) => [
	index("ix_product_channel_channel_id").using("btree", table.channelId.asc().nullsLast().op("uuid_ops")),
	index("ix_product_channel_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [printChannel.id],
			name: "product_channel_channel_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "product_channel_product_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "product_channel_store_id_fkey"
		}),
	primaryKey({ columns: [table.productId, table.channelId], name: "product_channel_pkey"}),
]);

export const stationDiscount = pgTable("station_discount", {
	stationId: uuid("station_id").notNull(),
	discountId: uuid("discount_id").notNull(),
	storeId: uuid("store_id").notNull(),
}, (table) => [
	index("ix_station_discount_discount_id").using("btree", table.discountId.asc().nullsLast().op("uuid_ops")),
	index("ix_station_discount_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.discountId],
			foreignColumns: [discount.id],
			name: "station_discount_discount_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.stationId],
			foreignColumns: [station.id],
			name: "station_discount_station_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "station_discount_store_id_fkey"
		}),
	primaryKey({ columns: [table.stationId, table.discountId], name: "station_discount_pkey"}),
]);

export const stationPaymentMethod = pgTable("station_payment_method", {
	stationId: uuid("station_id").notNull(),
	paymentMethodId: uuid("payment_method_id").notNull(),
	storeId: uuid("store_id").notNull(),
}, (table) => [
	index("ix_station_payment_method_payment_method_id").using("btree", table.paymentMethodId.asc().nullsLast().op("uuid_ops")),
	index("ix_station_payment_method_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.paymentMethodId],
			foreignColumns: [paymentMethod.id],
			name: "station_payment_method_payment_method_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.stationId],
			foreignColumns: [station.id],
			name: "station_payment_method_station_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "station_payment_method_store_id_fkey"
		}),
	primaryKey({ columns: [table.stationId, table.paymentMethodId], name: "station_payment_method_pkey"}),
]);

export const profilePermission = pgTable("profile_permission", {
	profileId: uuid("profile_id").notNull(),
	permissionCode: varchar("permission_code", { length: 40 }).notNull(),
	storeId: uuid("store_id").notNull(),
}, (table) => [
	index("ix_profile_permission_permission_code").using("btree", table.permissionCode.asc().nullsLast().op("text_ops")),
	index("ix_profile_permission_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.permissionCode],
			foreignColumns: [permission.code],
			name: "profile_permission_permission_code_fkey"
		}),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [userProfile.id],
			name: "profile_permission_profile_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "profile_permission_store_id_fkey"
		}),
	primaryKey({ columns: [table.profileId, table.permissionCode], name: "profile_permission_pkey"}),
]);

export const productQuestion = pgTable("product_question", {
	productId: uuid("product_id").notNull(),
	questionId: uuid("question_id").notNull(),
	storeId: uuid("store_id").notNull(),
	sortOrder: smallint("sort_order").default(0).notNull(),
}, (table) => [
	index("ix_product_question_question_id").using("btree", table.questionId.asc().nullsLast().op("uuid_ops")),
	index("ix_product_question_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "product_question_product_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [question.id],
			name: "product_question_question_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "product_question_store_id_fkey"
		}),
	primaryKey({ columns: [table.productId, table.questionId], name: "product_question_pkey"}),
]);

export const stationChannelPrinter = pgTable("station_channel_printer", {
	stationId: uuid("station_id").notNull(),
	channelId: uuid("channel_id").notNull(),
	printerId: uuid("printer_id").notNull(),
	storeId: uuid("store_id").notNull(),
}, (table) => [
	index("ix_station_channel_printer_channel_id").using("btree", table.channelId.asc().nullsLast().op("uuid_ops")),
	index("ix_station_channel_printer_printer_id").using("btree", table.printerId.asc().nullsLast().op("uuid_ops")),
	index("ix_station_channel_printer_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.channelId],
			foreignColumns: [printChannel.id],
			name: "station_channel_printer_channel_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.printerId],
			foreignColumns: [printer.id],
			name: "station_channel_printer_printer_id_fkey"
		}),
	foreignKey({
			columns: [table.stationId],
			foreignColumns: [station.id],
			name: "station_channel_printer_station_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "station_channel_printer_store_id_fkey"
		}),
	primaryKey({ columns: [table.stationId, table.channelId], name: "station_channel_printer_pkey"}),
]);

export const invoiceTax = pgTable("invoice_tax", {
	invoiceId: uuid("invoice_id").notNull(),
	rate: numeric({ precision: 5, scale:  2 }).notNull(),
	storeId: uuid("store_id").notNull(),
	base: numeric({ precision: 10, scale:  2 }).notNull(),
	tax: numeric({ precision: 10, scale:  2 }).notNull(),
}, (table) => [
	index("ix_invoice_tax_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoice.id],
			name: "invoice_tax_invoice_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "invoice_tax_store_id_fkey"
		}),
	primaryKey({ columns: [table.invoiceId, table.rate], name: "invoice_tax_pkey"}),
]);

export const invoiceSeries = pgTable("invoice_series", {
	storeId: uuid("store_id").notNull(),
	series: varchar({ length: 20 }).notNull(),
	kind: varchar({ length: 30 }).notNull(),
	lastSequence: integer("last_sequence").default(0).notNull(),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "invoice_series_store_id_fkey"
		}),
	primaryKey({ columns: [table.storeId, table.series], name: "invoice_series_pkey"}),
	check("invoice_series_kind_check", sql`(kind)::text = ANY (ARRAY[('F1'::character varying)::text, ('F2'::character varying)::text, ('R1'::character varying)::text])`),
]);

export const categoryProduct = pgTable("category_product", {
	categoryId: uuid("category_id").notNull(),
	productId: uuid("product_id").notNull(),
	storeId: uuid("store_id").notNull(),
	label: varchar({ length: 80 }),
	bgColor: varchar("bg_color", { length: 9 }),
	fgColor: varchar("fg_color", { length: 9 }),
	posX: smallint("pos_x"),
	posY: smallint("pos_y"),
}, (table) => [
	index("ix_category_product_product_id").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("ix_category_product_store_id").using("btree", table.storeId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: "category_product_category_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "category_product_product_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "category_product_store_id_fkey"
		}),
	primaryKey({ columns: [table.categoryId, table.productId], name: "category_product_pkey"}),
]);

export const idempotencyKey = pgTable("idempotency_key", {
	storeId: uuid("store_id").notNull(),
	key: varchar({ length: 80 }).notNull(),
	method: varchar({ length: 8 }).notNull(),
	path: varchar({ length: 200 }).notNull(),
	requestHash: char("request_hash", { length: 64 }).notNull(),
	statusCode: smallint("status_code").notNull(),
	response: jsonb().notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ix_idempotency_key_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.storeId],
			foreignColumns: [store.id],
			name: "idempotency_key_store_id_fkey"
		}),
	primaryKey({ columns: [table.storeId, table.key], name: "idempotency_key_pkey"}),
]);

// ── 0005 (añadido a mano tras la migración; mismo formato que db:pull) ──
export const periodSummary = pgTable("period_summary", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	periodId: uuid("period_id").notNull(),
	businessDate: date("business_date", { mode: "string" }).notNull(),
	openedAt: TS("opened_at").notNull(),
	closedAt: TS("closed_at").notNull(),
	grossSales: numeric("gross_sales", { precision: 10, scale: 2 }).notNull(),
	taxBase: numeric("tax_base", { precision: 10, scale: 2 }).notNull(),
	taxTotal: numeric("tax_total", { precision: 10, scale: 2 }).notNull(),
	tickets: integer().notNull(),
	guests: integer().notNull(),
	cashAmount: numeric("cash_amount", { precision: 10, scale: 2 }).default("0").notNull(),
	cardAmount: numeric("card_amount", { precision: 10, scale: 2 }).default("0").notNull(),
	otherAmount: numeric("other_amount", { precision: 10, scale: 2 }).default("0").notNull(),
	tips: numeric({ precision: 10, scale: 2 }).default("0").notNull(),
	discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }).default("0").notNull(),
	voidsCount: integer("voids_count").default(0).notNull(),
	voidsAmount: numeric("voids_amount", { precision: 10, scale: 2 }).default("0").notNull(),
	cashDifference: numeric("cash_difference", { precision: 10, scale: 2 }).default("0").notNull(),
	byHour: jsonb("by_hour").default({}).notNull(),
	byWaiter: jsonb("by_waiter").default([]).notNull(),
	byPayment: jsonb("by_payment").default([]).notNull(),
	voids: jsonb().default([]).notNull(),
	closedByUserName: varchar("closed_by_user_name", { length: 60 }),
	createdAt: TS("created_at").defaultNow().notNull(),
}, (table) => [
	index("ix_period_summary_store_id_business_date").using("btree", table.storeId.asc().nullsLast().op("uuid_ops"), table.businessDate.asc().nullsLast().op("date_ops")),
	foreignKey({ columns: [table.storeId], foreignColumns: [store.id], name: "period_summary_store_id_fkey" }),
	foreignKey({ columns: [table.periodId], foreignColumns: [salesPeriod.id], name: "period_summary_period_id_fkey" }),
	unique("uq_period_summary_period_id").on(table.periodId),
]);

export const salesTarget = pgTable("sales_target", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	year: smallint().notNull(),
	week: smallint().default(0).notNull(),
	growthPct: numeric("growth_pct", { precision: 5, scale: 2 }).default("0").notNull(),
	amount: numeric({ precision: 10, scale: 2 }),
	note: varchar({ length: 200 }),
	version: integer().default(1).notNull(),
	createdAt: TS("created_at").defaultNow().notNull(),
	updatedAt: TS("updated_at").defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.storeId], foreignColumns: [store.id], name: "sales_target_store_id_fkey" }),
	unique("uq_sales_target_store_id_year_week").on(table.storeId, table.year, table.week),
]);

export const syncState = pgTable("sync_state", {
	storeId: uuid("store_id").primaryKey().notNull(),
	lastSentAt: TS("last_sent_at"),
	lastSentId: bigint("last_sent_id", { mode: "number" }),
	lastLiveAt: TS("last_live_at"),
	lastHeartbeatAt: TS("last_heartbeat_at"),
	lastError: varchar("last_error", { length: 300 }),
	lastErrorAt: TS("last_error_at"),
	configCursor: varchar("config_cursor", { length: 60 }),
	managerTimeOffsetMs: integer("manager_time_offset_ms"),
	createdAt: TS("created_at").defaultNow().notNull(),
	updatedAt: TS("updated_at").defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.storeId], foreignColumns: [store.id], name: "sync_state_store_id_fkey" }),
]);

export const catalogRelease = pgTable("catalog_release", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	kind: varchar({ length: 20 }).notNull(),
	releaseVersion: integer("release_version").notNull(),
	effectiveAt: TS("effective_at").notNull(),
	status: varchar({ length: 20 }).default("pending").notNull(),
	payload: jsonb().notNull(),
	checksum: char({ length: 64 }).notNull(),
	receivedAt: TS("received_at").defaultNow().notNull(),
	appliedAt: TS("applied_at"),
	error: varchar({ length: 300 }),
	createdAt: TS("created_at").defaultNow().notNull(),
	updatedAt: TS("updated_at").defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.storeId], foreignColumns: [store.id], name: "catalog_release_store_id_fkey" }),
	unique("uq_catalog_release_store_id_release_version").on(table.storeId, table.releaseVersion),
]);

// Migración 0009 (añadido a mano, mismo estilo que drizzle-kit pull)
export const appSession = pgTable("app_session", {
	id: uuid().primaryKey().notNull(),
	storeId: uuid("store_id").notNull(),
	userId: uuid("user_id").notNull(),
	stationId: uuid("station_id"),
	stationName: varchar("station_name", { length: 40 }).notNull(),
	createdAt: timestamp("created_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { precision: 3, withTimezone: true, mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { precision: 3, withTimezone: true, mode: 'string' }),
	endedReason: varchar("ended_reason", { length: 20 }),
	replacedById: uuid("replaced_by_id"),
}, (table) => [
	index("ix_app_session_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	index("ix_app_session_station_id").using("btree", table.stationId.asc().nullsLast().op("uuid_ops")),
	index("ix_app_session_replaced_by_id").using("btree", table.replacedById.asc().nullsLast().op("uuid_ops")),
	foreignKey({ columns: [table.storeId], foreignColumns: [store.id], name: "app_session_store_id_fkey" }),
	foreignKey({ columns: [table.userId], foreignColumns: [appUser.id], name: "app_session_user_id_fkey" }),
	foreignKey({ columns: [table.stationId], foreignColumns: [station.id], name: "app_session_station_id_fkey" }),
	check("ck_app_session_ended_reason", sql`(ended_reason)::text = ANY (ARRAY[('replaced'::character varying)::text, ('logout'::character varying)::text])`),
]);

export const pinAttempt = pgTable("pin_attempt", {
	storeId: uuid("store_id").notNull(),
	key: varchar({ length: 80 }).notNull(),
	failures: smallint().default(0).notNull(),
	lockedUntil: timestamp("locked_until", { precision: 3, withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { precision: 3, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.storeId, table.key], name: "pin_attempt_pkey" }),
	foreignKey({ columns: [table.storeId], foreignColumns: [store.id], name: "pin_attempt_store_id_fkey" }),
	check("ck_pin_attempt_failures", sql`failures >= 0`),
]);

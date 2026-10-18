// ⚠️ GENERADO con `npm run db:pull` desde la base de japp-db. No editar a mano.
import { relations } from "drizzle-orm/relations";
import { userProfile, appUser, store, cashMovement, salesPeriod, reason, station, area, areaDrawing, billingSettings, cashClosing, customerRef, diningTable, incidentRequest, account, invoice, orders, orderLine, product, orderLineModifier, question, accountDiscount, discount, category, configChangeLog, orderEvent, orderLinePrinter, printer, paymentMethod, payment, paymentBankData, printChannel, tax, storeParameters, verifactuRecord, company, paymentCashDetail, productIncident, questionAnswer, syncOutbox, productChannel, stationDiscount, stationPaymentMethod, permission, profilePermission, productQuestion, stationChannelPrinter, invoiceTax, invoiceSeries, categoryProduct, idempotencyKey } from "./schema.js";

export const appUserRelations = relations(appUser, ({one, many}) => ({
	userProfile: one(userProfile, {
		fields: [appUser.profileId],
		references: [userProfile.id]
	}),
	store: one(store, {
		fields: [appUser.storeId],
		references: [store.id]
	}),
	cashMovements: many(cashMovement),
	cashClosings: many(cashClosing),
	invoices: many(invoice),
	orderLines_createdByUserId: many(orderLine, {
		relationName: "orderLine_createdByUserId_appUser_id"
	}),
	orderLines_deleteAuthorizedByUserId: many(orderLine, {
		relationName: "orderLine_deleteAuthorizedByUserId_appUser_id"
	}),
	orderLines_deletedByUserId: many(orderLine, {
		relationName: "orderLine_deletedByUserId_appUser_id"
	}),
	accountDiscounts_appliedByUserId: many(accountDiscount, {
		relationName: "accountDiscount_appliedByUserId_appUser_id"
	}),
	accountDiscounts_authorizedByUserId: many(accountDiscount, {
		relationName: "accountDiscount_authorizedByUserId_appUser_id"
	}),
	accountDiscounts_removedByUserId: many(accountDiscount, {
		relationName: "accountDiscount_removedByUserId_appUser_id"
	}),
	configChangeLogs: many(configChangeLog),
	orderEvents: many(orderEvent),
	payments: many(payment),
	salesPeriods_closedByUserId: many(salesPeriod, {
		relationName: "salesPeriod_closedByUserId_appUser_id"
	}),
	salesPeriods_openedByUserId: many(salesPeriod, {
		relationName: "salesPeriod_openedByUserId_appUser_id"
	}),
	accounts_closedByUserId: many(account, {
		relationName: "account_closedByUserId_appUser_id"
	}),
	accounts_lastEntryUserId: many(account, {
		relationName: "account_lastEntryUserId_appUser_id"
	}),
	accounts_openedByUserId: many(account, {
		relationName: "account_openedByUserId_appUser_id"
	}),
	orders_lastEntryUserId: many(orders, {
		relationName: "orders_lastEntryUserId_appUser_id"
	}),
	orders_lastExitUserId: many(orders, {
		relationName: "orders_lastExitUserId_appUser_id"
	}),
	orders_openedByUserId: many(orders, {
		relationName: "orders_openedByUserId_appUser_id"
	}),
}));

export const userProfileRelations = relations(userProfile, ({one, many}) => ({
	appUsers: many(appUser),
	store: one(store, {
		fields: [userProfile.storeId],
		references: [store.id]
	}),
	profilePermissions: many(profilePermission),
}));

export const storeRelations = relations(store, ({one, many}) => ({
	appUsers: many(appUser),
	cashMovements: many(cashMovement),
	areaDrawings: many(areaDrawing),
	billingSettings: many(billingSettings),
	cashClosings: many(cashClosing),
	customerRefs: many(customerRef),
	diningTables: many(diningTable),
	incidentRequests: many(incidentRequest),
	invoices: many(invoice),
	orderLines: many(orderLine),
	orderLineModifiers: many(orderLineModifier),
	accountDiscounts: many(accountDiscount),
	areas: many(area),
	categories: many(category),
	discounts: many(discount),
	configChangeLogs: many(configChangeLog),
	orderEvents: many(orderEvent),
	orderLinePrinters: many(orderLinePrinter),
	userProfiles: many(userProfile),
	paymentMethods: many(paymentMethod),
	paymentBankData: many(paymentBankData),
	printChannels: many(printChannel),
	products: many(product),
	stations: many(station),
	payments: many(payment),
	storeParameters: many(storeParameters),
	verifactuRecords: many(verifactuRecord),
	salesPeriods: many(salesPeriod),
	printers: many(printer),
	questions: many(question),
	reasons: many(reason),
	company: one(company, {
		fields: [store.companyId],
		references: [company.id]
	}),
	paymentCashDetails: many(paymentCashDetail),
	productIncidents: many(productIncident),
	questionAnswers: many(questionAnswer),
	syncOutboxes: many(syncOutbox),
	accounts: many(account),
	orders: many(orders),
	taxes: many(tax),
	productChannels: many(productChannel),
	stationDiscounts: many(stationDiscount),
	stationPaymentMethods: many(stationPaymentMethod),
	profilePermissions: many(profilePermission),
	productQuestions: many(productQuestion),
	stationChannelPrinters: many(stationChannelPrinter),
	invoiceTaxes: many(invoiceTax),
	invoiceSeries: many(invoiceSeries),
	categoryProducts: many(categoryProduct),
	idempotencyKeys: many(idempotencyKey),
}));

export const cashMovementRelations = relations(cashMovement, ({one}) => ({
	appUser: one(appUser, {
		fields: [cashMovement.byUserId],
		references: [appUser.id]
	}),
	salesPeriod: one(salesPeriod, {
		fields: [cashMovement.periodId],
		references: [salesPeriod.id]
	}),
	reason: one(reason, {
		fields: [cashMovement.reasonId],
		references: [reason.id]
	}),
	station: one(station, {
		fields: [cashMovement.stationId],
		references: [station.id]
	}),
	store: one(store, {
		fields: [cashMovement.storeId],
		references: [store.id]
	}),
}));

export const salesPeriodRelations = relations(salesPeriod, ({one, many}) => ({
	cashMovements: many(cashMovement),
	cashClosings: many(cashClosing),
	appUser_closedByUserId: one(appUser, {
		fields: [salesPeriod.closedByUserId],
		references: [appUser.id],
		relationName: "salesPeriod_closedByUserId_appUser_id"
	}),
	appUser_openedByUserId: one(appUser, {
		fields: [salesPeriod.openedByUserId],
		references: [appUser.id],
		relationName: "salesPeriod_openedByUserId_appUser_id"
	}),
	station: one(station, {
		fields: [salesPeriod.stationId],
		references: [station.id]
	}),
	store: one(store, {
		fields: [salesPeriod.storeId],
		references: [store.id]
	}),
	orders: many(orders),
}));

export const reasonRelations = relations(reason, ({one, many}) => ({
	cashMovements: many(cashMovement),
	orderLines: many(orderLine),
	store: one(store, {
		fields: [reason.storeId],
		references: [store.id]
	}),
}));

export const stationRelations = relations(station, ({one, many}) => ({
	cashMovements: many(cashMovement),
	store: one(store, {
		fields: [station.storeId],
		references: [store.id]
	}),
	payments: many(payment),
	salesPeriods: many(salesPeriod),
	stationDiscounts: many(stationDiscount),
	stationPaymentMethods: many(stationPaymentMethod),
	stationChannelPrinters: many(stationChannelPrinter),
}));

export const areaDrawingRelations = relations(areaDrawing, ({one}) => ({
	area: one(area, {
		fields: [areaDrawing.areaId],
		references: [area.id]
	}),
	store: one(store, {
		fields: [areaDrawing.storeId],
		references: [store.id]
	}),
}));

export const areaRelations = relations(area, ({one, many}) => ({
	areaDrawings: many(areaDrawing),
	diningTables: many(diningTable),
	store: one(store, {
		fields: [area.storeId],
		references: [store.id]
	}),
}));

export const billingSettingsRelations = relations(billingSettings, ({one}) => ({
	store: one(store, {
		fields: [billingSettings.storeId],
		references: [store.id]
	}),
}));

export const cashClosingRelations = relations(cashClosing, ({one}) => ({
	appUser: one(appUser, {
		fields: [cashClosing.byUserId],
		references: [appUser.id]
	}),
	salesPeriod: one(salesPeriod, {
		fields: [cashClosing.periodId],
		references: [salesPeriod.id]
	}),
	store: one(store, {
		fields: [cashClosing.storeId],
		references: [store.id]
	}),
}));

export const customerRefRelations = relations(customerRef, ({one, many}) => ({
	store: one(store, {
		fields: [customerRef.storeId],
		references: [store.id]
	}),
	invoices: many(invoice),
	accounts: many(account),
}));

export const diningTableRelations = relations(diningTable, ({one, many}) => ({
	area: one(area, {
		fields: [diningTable.areaId],
		references: [area.id]
	}),
	store: one(store, {
		fields: [diningTable.storeId],
		references: [store.id]
	}),
	orders: many(orders),
}));

export const incidentRequestRelations = relations(incidentRequest, ({one, many}) => ({
	store: one(store, {
		fields: [incidentRequest.storeId],
		references: [store.id]
	}),
	productIncidents: many(productIncident),
}));

export const invoiceRelations = relations(invoice, ({one, many}) => ({
	account: one(account, {
		fields: [invoice.accountId],
		references: [account.id]
	}),
	customerRef: one(customerRef, {
		fields: [invoice.customerId],
		references: [customerRef.id]
	}),
	appUser: one(appUser, {
		fields: [invoice.issuedByUserId],
		references: [appUser.id]
	}),
	order: one(orders, {
		fields: [invoice.orderId],
		references: [orders.id]
	}),
	invoice: one(invoice, {
		fields: [invoice.rectifiedInvoiceId],
		references: [invoice.id],
		relationName: "invoice_rectifiedInvoiceId_invoice_id"
	}),
	invoices: many(invoice, {
		relationName: "invoice_rectifiedInvoiceId_invoice_id"
	}),
	store: one(store, {
		fields: [invoice.storeId],
		references: [store.id]
	}),
	verifactuRecords: many(verifactuRecord),
	invoiceTaxes: many(invoiceTax),
}));

export const accountRelations = relations(account, ({one, many}) => ({
	invoices: many(invoice),
	orderLines: many(orderLine),
	accountDiscounts: many(accountDiscount),
	orderEvents: many(orderEvent),
	payments: many(payment),
	appUser_closedByUserId: one(appUser, {
		fields: [account.closedByUserId],
		references: [appUser.id],
		relationName: "account_closedByUserId_appUser_id"
	}),
	customerRef: one(customerRef, {
		fields: [account.customerId],
		references: [customerRef.id]
	}),
	appUser_lastEntryUserId: one(appUser, {
		fields: [account.lastEntryUserId],
		references: [appUser.id],
		relationName: "account_lastEntryUserId_appUser_id"
	}),
	appUser_openedByUserId: one(appUser, {
		fields: [account.openedByUserId],
		references: [appUser.id],
		relationName: "account_openedByUserId_appUser_id"
	}),
	order: one(orders, {
		fields: [account.orderId],
		references: [orders.id]
	}),
	store: one(store, {
		fields: [account.storeId],
		references: [store.id]
	}),
}));

export const ordersRelations = relations(orders, ({one, many}) => ({
	invoices: many(invoice),
	orderLines: many(orderLine),
	orderEvents: many(orderEvent),
	accounts: many(account),
	appUser_lastEntryUserId: one(appUser, {
		fields: [orders.lastEntryUserId],
		references: [appUser.id],
		relationName: "orders_lastEntryUserId_appUser_id"
	}),
	appUser_lastExitUserId: one(appUser, {
		fields: [orders.lastExitUserId],
		references: [appUser.id],
		relationName: "orders_lastExitUserId_appUser_id"
	}),
	appUser_openedByUserId: one(appUser, {
		fields: [orders.openedByUserId],
		references: [appUser.id],
		relationName: "orders_openedByUserId_appUser_id"
	}),
	salesPeriod: one(salesPeriod, {
		fields: [orders.periodId],
		references: [salesPeriod.id]
	}),
	store: one(store, {
		fields: [orders.storeId],
		references: [store.id]
	}),
	diningTable: one(diningTable, {
		fields: [orders.tableId],
		references: [diningTable.id]
	}),
}));

export const orderLineRelations = relations(orderLine, ({one, many}) => ({
	account: one(account, {
		fields: [orderLine.accountId],
		references: [account.id]
	}),
	appUser_createdByUserId: one(appUser, {
		fields: [orderLine.createdByUserId],
		references: [appUser.id],
		relationName: "orderLine_createdByUserId_appUser_id"
	}),
	appUser_deleteAuthorizedByUserId: one(appUser, {
		fields: [orderLine.deleteAuthorizedByUserId],
		references: [appUser.id],
		relationName: "orderLine_deleteAuthorizedByUserId_appUser_id"
	}),
	reason: one(reason, {
		fields: [orderLine.deleteReasonId],
		references: [reason.id]
	}),
	appUser_deletedByUserId: one(appUser, {
		fields: [orderLine.deletedByUserId],
		references: [appUser.id],
		relationName: "orderLine_deletedByUserId_appUser_id"
	}),
	order: one(orders, {
		fields: [orderLine.orderId],
		references: [orders.id]
	}),
	product: one(product, {
		fields: [orderLine.productId],
		references: [product.id]
	}),
	orderLine: one(orderLine, {
		fields: [orderLine.sourceLineId],
		references: [orderLine.id],
		relationName: "orderLine_sourceLineId_orderLine_id"
	}),
	orderLines: many(orderLine, {
		relationName: "orderLine_sourceLineId_orderLine_id"
	}),
	store: one(store, {
		fields: [orderLine.storeId],
		references: [store.id]
	}),
	orderLineModifiers: many(orderLineModifier),
	orderLinePrinters: many(orderLinePrinter),
}));

export const productRelations = relations(product, ({one, many}) => ({
	orderLines: many(orderLine),
	orderLineModifiers: many(orderLineModifier),
	category: one(category, {
		fields: [product.categoryId],
		references: [category.id]
	}),
	store: one(store, {
		fields: [product.storeId],
		references: [store.id]
	}),
	tax: one(tax, {
		fields: [product.taxId],
		references: [tax.id]
	}),
	productIncidents: many(productIncident),
	questionAnswers: many(questionAnswer),
	productChannels: many(productChannel),
	productQuestions: many(productQuestion),
	categoryProducts: many(categoryProduct),
}));

export const orderLineModifierRelations = relations(orderLineModifier, ({one}) => ({
	orderLine: one(orderLine, {
		fields: [orderLineModifier.lineId],
		references: [orderLine.id]
	}),
	product: one(product, {
		fields: [orderLineModifier.productId],
		references: [product.id]
	}),
	question: one(question, {
		fields: [orderLineModifier.questionId],
		references: [question.id]
	}),
	store: one(store, {
		fields: [orderLineModifier.storeId],
		references: [store.id]
	}),
}));

export const questionRelations = relations(question, ({one, many}) => ({
	orderLineModifiers: many(orderLineModifier),
	store: one(store, {
		fields: [question.storeId],
		references: [store.id]
	}),
	questionAnswers: many(questionAnswer),
	productQuestions: many(productQuestion),
}));

export const accountDiscountRelations = relations(accountDiscount, ({one}) => ({
	account: one(account, {
		fields: [accountDiscount.accountId],
		references: [account.id]
	}),
	appUser_appliedByUserId: one(appUser, {
		fields: [accountDiscount.appliedByUserId],
		references: [appUser.id],
		relationName: "accountDiscount_appliedByUserId_appUser_id"
	}),
	appUser_authorizedByUserId: one(appUser, {
		fields: [accountDiscount.authorizedByUserId],
		references: [appUser.id],
		relationName: "accountDiscount_authorizedByUserId_appUser_id"
	}),
	discount: one(discount, {
		fields: [accountDiscount.discountId],
		references: [discount.id]
	}),
	appUser_removedByUserId: one(appUser, {
		fields: [accountDiscount.removedByUserId],
		references: [appUser.id],
		relationName: "accountDiscount_removedByUserId_appUser_id"
	}),
	store: one(store, {
		fields: [accountDiscount.storeId],
		references: [store.id]
	}),
}));

export const discountRelations = relations(discount, ({one, many}) => ({
	accountDiscounts: many(accountDiscount),
	store: one(store, {
		fields: [discount.storeId],
		references: [store.id]
	}),
	stationDiscounts: many(stationDiscount),
}));

export const categoryRelations = relations(category, ({one, many}) => ({
	store: one(store, {
		fields: [category.storeId],
		references: [store.id]
	}),
	products: many(product),
	categoryProducts: many(categoryProduct),
}));

export const configChangeLogRelations = relations(configChangeLog, ({one}) => ({
	store: one(store, {
		fields: [configChangeLog.storeId],
		references: [store.id]
	}),
	appUser: one(appUser, {
		fields: [configChangeLog.userId],
		references: [appUser.id]
	}),
}));

export const orderEventRelations = relations(orderEvent, ({one}) => ({
	account: one(account, {
		fields: [orderEvent.accountId],
		references: [account.id]
	}),
	order: one(orders, {
		fields: [orderEvent.orderId],
		references: [orders.id]
	}),
	store: one(store, {
		fields: [orderEvent.storeId],
		references: [store.id]
	}),
	appUser: one(appUser, {
		fields: [orderEvent.userId],
		references: [appUser.id]
	}),
}));

export const orderLinePrinterRelations = relations(orderLinePrinter, ({one}) => ({
	orderLine: one(orderLine, {
		fields: [orderLinePrinter.lineId],
		references: [orderLine.id]
	}),
	printer: one(printer, {
		fields: [orderLinePrinter.printerId],
		references: [printer.id]
	}),
	store: one(store, {
		fields: [orderLinePrinter.storeId],
		references: [store.id]
	}),
}));

export const printerRelations = relations(printer, ({one, many}) => ({
	orderLinePrinters: many(orderLinePrinter),
	store: one(store, {
		fields: [printer.storeId],
		references: [store.id]
	}),
	stationChannelPrinters: many(stationChannelPrinter),
}));

export const paymentMethodRelations = relations(paymentMethod, ({one, many}) => ({
	store: one(store, {
		fields: [paymentMethod.storeId],
		references: [store.id]
	}),
	payments: many(payment),
	stationPaymentMethods: many(stationPaymentMethod),
}));

export const paymentBankDataRelations = relations(paymentBankData, ({one}) => ({
	payment: one(payment, {
		fields: [paymentBankData.paymentId],
		references: [payment.id]
	}),
	store: one(store, {
		fields: [paymentBankData.storeId],
		references: [store.id]
	}),
}));

export const paymentRelations = relations(payment, ({one, many}) => ({
	paymentBankData: many(paymentBankData),
	account: one(account, {
		fields: [payment.accountId],
		references: [account.id]
	}),
	appUser: one(appUser, {
		fields: [payment.collectedByUserId],
		references: [appUser.id]
	}),
	paymentMethod: one(paymentMethod, {
		fields: [payment.paymentMethodId],
		references: [paymentMethod.id]
	}),
	station: one(station, {
		fields: [payment.stationId],
		references: [station.id]
	}),
	store: one(store, {
		fields: [payment.storeId],
		references: [store.id]
	}),
	paymentCashDetails: many(paymentCashDetail),
}));

export const printChannelRelations = relations(printChannel, ({one, many}) => ({
	store: one(store, {
		fields: [printChannel.storeId],
		references: [store.id]
	}),
	productChannels: many(productChannel),
	stationChannelPrinters: many(stationChannelPrinter),
}));

export const taxRelations = relations(tax, ({one, many}) => ({
	products: many(product),
	store: one(store, {
		fields: [tax.storeId],
		references: [store.id]
	}),
}));

export const storeParametersRelations = relations(storeParameters, ({one}) => ({
	store: one(store, {
		fields: [storeParameters.storeId],
		references: [store.id]
	}),
}));

export const verifactuRecordRelations = relations(verifactuRecord, ({one, many}) => ({
	invoice: one(invoice, {
		fields: [verifactuRecord.invoiceId],
		references: [invoice.id]
	}),
	verifactuRecord: one(verifactuRecord, {
		fields: [verifactuRecord.previousRecordId],
		references: [verifactuRecord.id],
		relationName: "verifactuRecord_previousRecordId_verifactuRecord_id"
	}),
	verifactuRecords: many(verifactuRecord, {
		relationName: "verifactuRecord_previousRecordId_verifactuRecord_id"
	}),
	store: one(store, {
		fields: [verifactuRecord.storeId],
		references: [store.id]
	}),
}));

export const companyRelations = relations(company, ({many}) => ({
	stores: many(store),
}));

export const paymentCashDetailRelations = relations(paymentCashDetail, ({one}) => ({
	payment: one(payment, {
		fields: [paymentCashDetail.paymentId],
		references: [payment.id]
	}),
	store: one(store, {
		fields: [paymentCashDetail.storeId],
		references: [store.id]
	}),
}));

export const productIncidentRelations = relations(productIncident, ({one}) => ({
	product: one(product, {
		fields: [productIncident.productId],
		references: [product.id]
	}),
	incidentRequest: one(incidentRequest, {
		fields: [productIncident.requestId],
		references: [incidentRequest.id]
	}),
	store: one(store, {
		fields: [productIncident.storeId],
		references: [store.id]
	}),
}));

export const questionAnswerRelations = relations(questionAnswer, ({one}) => ({
	product: one(product, {
		fields: [questionAnswer.productId],
		references: [product.id]
	}),
	question: one(question, {
		fields: [questionAnswer.questionId],
		references: [question.id]
	}),
	store: one(store, {
		fields: [questionAnswer.storeId],
		references: [store.id]
	}),
}));

export const syncOutboxRelations = relations(syncOutbox, ({one}) => ({
	store: one(store, {
		fields: [syncOutbox.storeId],
		references: [store.id]
	}),
}));

export const productChannelRelations = relations(productChannel, ({one}) => ({
	printChannel: one(printChannel, {
		fields: [productChannel.channelId],
		references: [printChannel.id]
	}),
	product: one(product, {
		fields: [productChannel.productId],
		references: [product.id]
	}),
	store: one(store, {
		fields: [productChannel.storeId],
		references: [store.id]
	}),
}));

export const stationDiscountRelations = relations(stationDiscount, ({one}) => ({
	discount: one(discount, {
		fields: [stationDiscount.discountId],
		references: [discount.id]
	}),
	station: one(station, {
		fields: [stationDiscount.stationId],
		references: [station.id]
	}),
	store: one(store, {
		fields: [stationDiscount.storeId],
		references: [store.id]
	}),
}));

export const stationPaymentMethodRelations = relations(stationPaymentMethod, ({one}) => ({
	paymentMethod: one(paymentMethod, {
		fields: [stationPaymentMethod.paymentMethodId],
		references: [paymentMethod.id]
	}),
	station: one(station, {
		fields: [stationPaymentMethod.stationId],
		references: [station.id]
	}),
	store: one(store, {
		fields: [stationPaymentMethod.storeId],
		references: [store.id]
	}),
}));

export const profilePermissionRelations = relations(profilePermission, ({one}) => ({
	permission: one(permission, {
		fields: [profilePermission.permissionCode],
		references: [permission.code]
	}),
	userProfile: one(userProfile, {
		fields: [profilePermission.profileId],
		references: [userProfile.id]
	}),
	store: one(store, {
		fields: [profilePermission.storeId],
		references: [store.id]
	}),
}));

export const permissionRelations = relations(permission, ({many}) => ({
	profilePermissions: many(profilePermission),
}));

export const productQuestionRelations = relations(productQuestion, ({one}) => ({
	product: one(product, {
		fields: [productQuestion.productId],
		references: [product.id]
	}),
	question: one(question, {
		fields: [productQuestion.questionId],
		references: [question.id]
	}),
	store: one(store, {
		fields: [productQuestion.storeId],
		references: [store.id]
	}),
}));

export const stationChannelPrinterRelations = relations(stationChannelPrinter, ({one}) => ({
	printChannel: one(printChannel, {
		fields: [stationChannelPrinter.channelId],
		references: [printChannel.id]
	}),
	printer: one(printer, {
		fields: [stationChannelPrinter.printerId],
		references: [printer.id]
	}),
	station: one(station, {
		fields: [stationChannelPrinter.stationId],
		references: [station.id]
	}),
	store: one(store, {
		fields: [stationChannelPrinter.storeId],
		references: [store.id]
	}),
}));

export const invoiceTaxRelations = relations(invoiceTax, ({one}) => ({
	invoice: one(invoice, {
		fields: [invoiceTax.invoiceId],
		references: [invoice.id]
	}),
	store: one(store, {
		fields: [invoiceTax.storeId],
		references: [store.id]
	}),
}));

export const invoiceSeriesRelations = relations(invoiceSeries, ({one}) => ({
	store: one(store, {
		fields: [invoiceSeries.storeId],
		references: [store.id]
	}),
}));

export const categoryProductRelations = relations(categoryProduct, ({one}) => ({
	category: one(category, {
		fields: [categoryProduct.categoryId],
		references: [category.id]
	}),
	product: one(product, {
		fields: [categoryProduct.productId],
		references: [product.id]
	}),
	store: one(store, {
		fields: [categoryProduct.storeId],
		references: [store.id]
	}),
}));

export const idempotencyKeyRelations = relations(idempotencyKey, ({one}) => ({
	store: one(store, {
		fields: [idempotencyKey.storeId],
		references: [store.id]
	}),
}));
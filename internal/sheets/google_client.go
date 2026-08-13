package sheets

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/api/option"
	googleSheets "google.golang.org/api/sheets/v4"
)

const GoogleSheetsScope = googleSheets.SpreadsheetsScope

// GoogleSheetsClient adapts the official Sheets API client to this project's
// small Client interface. Keeping the generated client behind the interface
// preserves deterministic adapter tests and isolates authentication details.
type GoogleSheetsClient struct {
	service *googleSheets.Service
}

func NewGoogleSheetsClient(ctx context.Context, credentialsPath string) (*GoogleSheetsClient, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if credentialsPath == "" {
		return nil, errors.New("Google Sheets credentials path is required")
	}
	service, err := googleSheets.NewService(ctx,
		option.WithServiceAccountFile(credentialsPath),
		option.WithScopes(GoogleSheetsScope),
	)
	if err != nil {
		return nil, fmt.Errorf("create Google Sheets client: %w", err)
	}
	return &GoogleSheetsClient{service: service}, nil
}

func newGoogleSheetsClient(service *googleSheets.Service) *GoogleSheetsClient {
	return &GoogleSheetsClient{service: service}
}

func (c *GoogleSheetsClient) Get(ctx context.Context, spreadsheetID, readRange string) ([][]any, error) {
	if c == nil || c.service == nil {
		return nil, errors.New("Google Sheets client is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	values, err := c.service.Spreadsheets.Values.Get(spreadsheetID, readRange).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	if values == nil {
		return nil, nil
	}
	return values.Values, nil
}

func (c *GoogleSheetsClient) BatchUpdate(ctx context.Context, spreadsheetID string, data []ValueRange) (*int, error) {
	if c == nil || c.service == nil {
		return nil, errors.New("Google Sheets client is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	requestData := make([]*googleSheets.ValueRange, 0, len(data))
	for _, valueRange := range data {
		requestData = append(requestData, &googleSheets.ValueRange{
			Range:  valueRange.Range,
			Values: valueRange.Values,
		})
	}
	response, err := c.service.Spreadsheets.Values.BatchUpdate(spreadsheetID, &googleSheets.BatchUpdateValuesRequest{
		ValueInputOption: "USER_ENTERED",
		Data:             requestData,
	}).Context(ctx).Do()
	if err != nil {
		return nil, err
	}
	if response == nil {
		return nil, nil
	}
	updated := int(response.TotalUpdatedCells)
	return &updated, nil
}

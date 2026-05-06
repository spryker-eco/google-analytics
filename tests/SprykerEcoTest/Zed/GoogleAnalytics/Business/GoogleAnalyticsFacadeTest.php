<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEcoTest\Zed\GoogleAnalytics\Business;

use Codeception\Test\Unit;
use DateTime;
use Generated\Shared\Transfer\GoogleAnalyticsEventConditionsTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Generated\Shared\Transfer\PaginationTransfer;
use Google\Analytics\Data\V1beta\DimensionHeader;
use Google\Analytics\Data\V1beta\DimensionValue;
use Google\Analytics\Data\V1beta\MetricValue;
use Google\Analytics\Data\V1beta\Row;
use Google\Analytics\Data\V1beta\RunReportResponse;
use SprykerEco\Zed\GoogleAnalytics\Business\Client\GoogleAnalyticsDataClientInterface;
use SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsFacadeInterface;
use SprykerEco\Zed\GoogleAnalytics\Business\Reader\GoogleAnalyticsReader;
use SprykerEco\Zed\GoogleAnalytics\GoogleAnalyticsConfig;
use SprykerEcoTest\Zed\GoogleAnalytics\GoogleAnalyticsBusinessTester;

/**
 * @group SprykerEcoTest
 * @group Zed
 * @group GoogleAnalytics
 * @group Business
 * @group GoogleAnalyticsFacadeTest
 */
class GoogleAnalyticsFacadeTest extends Unit
{
    protected GoogleAnalyticsBusinessTester $tester;

    protected const string DEFAULT_DATE_RANGE_PRESET = '-7 days';

    public function testGetEventCollectionAppliesDefaultDateRangeWhenNoneProvided(): void
    {
        // Arrange
        $config = $this->buildConfigMock();
        $config->method('getDefaultDateRangePreset')->willReturn(static::DEFAULT_DATE_RANGE_PRESET);

        $expectedStartDate = (new DateTime(static::DEFAULT_DATE_RANGE_PRESET))->format('Y-m-d');
        $expectedEndDate = (new DateTime())->format('Y-m-d');

        $facade = $this->buildFacade($config, $this->buildClientMock(new RunReportResponse()));

        $conditions = (new GoogleAnalyticsEventConditionsTransfer())->setEventName('search_results');

        // Act
        $facade->getEventCollection($this->buildCriteria($conditions));

        // Assert
        $this->assertSame($expectedStartDate, $conditions->getStartDate());
        $this->assertSame($expectedEndDate, $conditions->getEndDate());
    }

    public function testGetEventCollectionPreservesProvidedDateRange(): void
    {
        // Arrange
        $facade = $this->buildFacade($this->buildConfigMock(), $this->buildClientMock(new RunReportResponse()));

        $conditions = (new GoogleAnalyticsEventConditionsTransfer())
            ->setEventName('search_results')
            ->setStartDate('2024-01-01')
            ->setEndDate('2024-01-31');

        // Act
        $facade->getEventCollection($this->buildCriteria($conditions));

        // Assert
        $this->assertSame('2024-01-01', $conditions->getStartDate());
        $this->assertSame('2024-01-31', $conditions->getEndDate());
    }

    public function testGetEventCollectionDoesNotCallDefaultPresetWhenBothDatesProvided(): void
    {
        // Arrange
        $config = $this->buildConfigMock();
        $config->expects($this->never())->method('getDefaultDateRangePreset');

        $facade = $this->buildFacade($config, $this->buildClientMock(new RunReportResponse()));

        $conditions = (new GoogleAnalyticsEventConditionsTransfer())
            ->setEventName('search_results')
            ->setStartDate('2024-06-01')
            ->setEndDate('2024-06-30');

        // Act
        $facade->getEventCollection($this->buildCriteria($conditions));

        // Assert
        $this->assertSame('2024-06-01', $conditions->getStartDate());
        $this->assertSame('2024-06-30', $conditions->getEndDate());
    }

    public function testGetEventCollectionReturnsEmptyCollectionWhenApiReturnsNoRows(): void
    {
        // Arrange
        $facade = $this->buildFacade($this->buildConfigMock(), $this->buildClientMock(new RunReportResponse()));

        // Act
        $collection = $facade->getEventCollection($this->buildCriteriaWithDateRange('2024-01-01', '2024-01-31'));

        // Assert
        $this->assertCount(0, $collection->getEvents());
        $this->assertSame(0, $collection->getPagination()->getNbResults());
    }

    public function testGetEventCollectionMapsSearchTermFromApiResponse(): void
    {
        // Arrange
        $facade = $this->buildFacade($this->buildConfigMock(), $this->buildClientMock($this->buildSingleRowResponse('blue shoes', 42)));

        // Act
        $collection = $facade->getEventCollection($this->buildCriteriaWithDateRange('2024-01-01', '2024-01-31'));
        $events = $collection->getEvents();

        // Assert
        $this->assertCount(1, $events);
        $this->assertSame('blue shoes', $events[0]->getSearchTerm());
        $this->assertSame(42, $events[0]->getCount());
        $this->assertNull($events[0]->getStore());
        $this->assertNull($events[0]->getLocale());
    }

    public function testGetEventCollectionSetsNbResultsFromApiRowCount(): void
    {
        // Arrange
        $response = new RunReportResponse([
            'dimension_headers' => [new DimensionHeader(['name' => 'searchTerm'])],
            'rows' => [
                new Row([
                    'dimension_values' => [new DimensionValue(['value' => 'shoes'])],
                    'metric_values' => [new MetricValue(['value' => '5'])],
                ]),
            ],
            'row_count' => 99,
        ]);

        $facade = $this->buildFacade($this->buildConfigMock(), $this->buildClientMock($response));

        // Act
        $collection = $facade->getEventCollection($this->buildCriteriaWithDateRange('2024-01-01', '2024-01-31'));

        // Assert
        $this->assertSame(99, $collection->getPagination()->getNbResults());
    }

    public function testGetEventCollectionMapsStoreDimensionWhenConfigured(): void
    {
        // Arrange
        $config = $this->createMock(GoogleAnalyticsConfig::class);
        $config->method('getPropertyId')->willReturn('123456789');
        $config->method('getStoreDimensionName')->willReturn('customEvent:store');
        $config->method('getLocaleDimensionName')->willReturn('customEvent:locale');

        $response = new RunReportResponse([
            'dimension_headers' => [
                new DimensionHeader(['name' => 'searchTerm']),
                new DimensionHeader(['name' => 'customEvent:store']),
                new DimensionHeader(['name' => 'customEvent:locale']),
            ],
            'rows' => [
                new Row([
                    'dimension_values' => [
                        new DimensionValue(['value' => 'sneakers']),
                        new DimensionValue(['value' => 'DE']),
                        new DimensionValue(['value' => 'de_DE']),
                    ],
                    'metric_values' => [new MetricValue(['value' => '10'])],
                ]),
            ],
            'row_count' => 1,
        ]);

        $facade = $this->buildFacade($config, $this->buildClientMock($response));

        // Act
        $collection = $facade->getEventCollection($this->buildCriteriaWithDateRange('2024-01-01', '2024-01-31'));

        // Assert
        $events = $collection->getEvents();

        $this->assertCount(1, $events);
        $this->assertSame('sneakers', $events[0]->getSearchTerm());
        $this->assertSame('DE', $events[0]->getStore());
        $this->assertSame('de_DE', $events[0]->getLocale());
    }

    public function testGetEventCollectionNormalizesGa4NotSetSentinelToNull(): void
    {
        // Arrange
        $config = $this->buildConfigMock();
        $config->method('getStoreDimensionName')->willReturn('customEvent:store');
        $config->method('getLocaleDimensionName')->willReturn(null);

        $response = new RunReportResponse([
            'dimension_headers' => [
                new DimensionHeader(['name' => 'searchTerm']),
                new DimensionHeader(['name' => 'customEvent:store']),
            ],
            'rows' => [
                new Row([
                    'dimension_values' => [
                        new DimensionValue(['value' => 'boots']),
                        new DimensionValue(['value' => '(not set)']),
                    ],
                    'metric_values' => [new MetricValue(['value' => '3'])],
                ]),
            ],
            'row_count' => 1,
        ]);

        $facade = $this->buildFacade($config, $this->buildClientMock($response));

        // Act
        $collection = $facade->getEventCollection($this->buildCriteriaWithDateRange('2024-01-01', '2024-01-31'));
        $events = $collection->getEvents();

        // Assert
        $this->assertCount(1, $events);
        $this->assertNull($events[0]->getStore());
    }

    public function testGetEventCollectionPopulatesLastOccurredAtWhenRequested(): void
    {
        // Arrange
        $config = $this->buildConfigMock();

        // First call (terms report) returns the term; second call (dates report) returns date row.
        $termsResponse = new RunReportResponse([
            'dimension_headers' => [new DimensionHeader(['name' => 'searchTerm'])],
            'rows' => [
                new Row([
                    'dimension_values' => [new DimensionValue(['value' => 'jacket'])],
                    'metric_values' => [new MetricValue(['value' => '7'])],
                ]),
            ],
            'row_count' => 1,
        ]);

        $datesResponse = new RunReportResponse([
            'dimension_headers' => [
                new DimensionHeader(['name' => 'searchTerm']),
                new DimensionHeader(['name' => 'date']),
            ],
            'rows' => [
                new Row([
                    'dimension_values' => [
                        new DimensionValue(['value' => 'jacket']),
                        new DimensionValue(['value' => '20240115']),
                    ],
                    'metric_values' => [new MetricValue(['value' => '7'])],
                ]),
            ],
            'row_count' => 1,
        ]);

        $client = $this->createMock(GoogleAnalyticsDataClientInterface::class);
        $client->method('runReport')->willReturnOnConsecutiveCalls($termsResponse, $datesResponse);

        $conditions = (new GoogleAnalyticsEventConditionsTransfer())
            ->setEventName('search_results')
            ->setStartDate('2024-01-01')
            ->setEndDate('2024-01-31')
            ->setWithLastOccurred(true);

        $facade = $this->buildFacade($config, $client);

        // Act
        $collection = $facade->getEventCollection($this->buildCriteria($conditions));
        $events = $collection->getEvents();

        // Assert
        $this->assertCount(1, $events);
        $this->assertSame('2024-01-15', $events[0]->getLastOccurredAt());
    }

    protected function buildFacade(GoogleAnalyticsConfig $config, GoogleAnalyticsDataClientInterface $client): GoogleAnalyticsFacadeInterface
    {
        $this->tester->mockFactoryMethod('createGoogleAnalyticsReader', new GoogleAnalyticsReader($config, $client));

        return $this->tester->getFacade();
    }

    protected function buildCriteria(GoogleAnalyticsEventConditionsTransfer $conditions): GoogleAnalyticsEventCriteriaTransfer
    {
        return (new GoogleAnalyticsEventCriteriaTransfer())
            ->setConditions($conditions)
            ->setPagination((new PaginationTransfer())->setLimit(10)->setOffset(0));
    }

    protected function buildCriteriaWithDateRange(string $startDate, string $endDate): GoogleAnalyticsEventCriteriaTransfer
    {
        return $this->buildCriteria(
            (new GoogleAnalyticsEventConditionsTransfer())
                ->setEventName('search_results')
                ->setStartDate($startDate)
                ->setEndDate($endDate),
        );
    }

    protected function buildConfigMock(): GoogleAnalyticsConfig
    {
        $config = $this->createMock(GoogleAnalyticsConfig::class);
        $config->method('getPropertyId')->willReturn('123456789');
        $config->method('getStoreDimensionName')->willReturn(null);
        $config->method('getLocaleDimensionName')->willReturn(null);

        return $config;
    }

    protected function buildClientMock(RunReportResponse $response): GoogleAnalyticsDataClientInterface
    {
        $client = $this->createMock(GoogleAnalyticsDataClientInterface::class);
        $client->method('runReport')->willReturn($response);

        return $client;
    }

    protected function buildSingleRowResponse(string $searchTerm, int $count): RunReportResponse
    {
        return new RunReportResponse([
            'dimension_headers' => [new DimensionHeader(['name' => 'searchTerm'])],
            'rows' => [
                new Row([
                    'dimension_values' => [new DimensionValue(['value' => $searchTerm])],
                    'metric_values' => [new MetricValue(['value' => (string)$count])],
                ]),
            ],
            'row_count' => 1,
        ]);
    }
}

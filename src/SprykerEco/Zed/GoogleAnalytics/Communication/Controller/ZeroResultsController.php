<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Controller;

use Generated\Shared\Transfer\GoogleAnalyticsEventConditionsTransfer;
use Generated\Shared\Transfer\GoogleAnalyticsEventCriteriaTransfer;
use Spryker\Zed\Kernel\Communication\Controller\AbstractController;
use SprykerEco\Zed\GoogleAnalytics\Communication\Form\ZeroResultsFilterForm;
use SprykerEco\Zed\GoogleAnalytics\Communication\Table\ZeroResultsTable;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

/**
 * @method \SprykerEco\Zed\GoogleAnalytics\Communication\GoogleAnalyticsCommunicationFactory getFactory()
 * @method \SprykerEco\Zed\GoogleAnalytics\Business\GoogleAnalyticsFacadeInterface getFacade()
 */
class ZeroResultsController extends AbstractController
{
    /**
     * @param \Symfony\Component\HttpFoundation\Request $request
     *
     * @return array<string, mixed>
     */
    public function indexAction(Request $request): array
    {
        $form = $this->getFactory()->createZeroResultsFilterForm();
        $form->handleRequest($request);

        $table = $this->createTable($form->getData() ?? []);

        return $this->viewResponse([
            'table' => $table->render(),
            'form' => $form->createView(),
        ]);
    }

    public function tableAction(Request $request): JsonResponse
    {
        $form = $this->getFactory()->createZeroResultsFilterForm();
        $form->handleRequest($request);

        $table = $this->createTable($form->getData() ?? []);

        return $this->jsonResponse($table->fetchData());
    }

    /**
     * @param array<string, mixed> $formData
     */
    protected function createTable(array $formData): ZeroResultsTable
    {
        $dates = $this->getFactory()->createEventCriteriaResolver()->resolveDateRange($formData);

        return $this->getFactory()->createZeroResultsTable(
            (new GoogleAnalyticsEventCriteriaTransfer())
                ->setConditions((new GoogleAnalyticsEventConditionsTransfer())
                    ->setStartDate($dates['startDate'] ?? null)
                    ->setEndDate($dates['endDate'] ?? null)
                    ->setMinimumCount(($formData[ZeroResultsFilterForm::FIELD_MINIMUM_COUNT] ?? 0))
                    ->setStore($formData[ZeroResultsFilterForm::FIELD_STORE] ?? null)
                    ->setLocale($formData[ZeroResultsFilterForm::FIELD_LOCALE] ?? null)),
        );
    }
}

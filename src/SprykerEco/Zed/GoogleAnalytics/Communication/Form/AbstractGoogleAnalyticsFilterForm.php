<?php

/**
 * Copyright © 2016-present Spryker Systems GmbH. All rights reserved.
 * Use of this software requires acceptance of the Evaluation License Agreement. See LICENSE file.
 */

declare(strict_types = 1);

namespace SprykerEco\Zed\GoogleAnalytics\Communication\Form;

use Spryker\Zed\Gui\Communication\Form\Type\DatePickerType;
use Symfony\Component\Form\AbstractType;
use Symfony\Component\Form\Extension\Core\Type\ChoiceType;
use Symfony\Component\Form\FormBuilderInterface;
use Symfony\Component\OptionsResolver\OptionsResolver;

abstract class AbstractGoogleAnalyticsFilterForm extends AbstractType
{
    public const string FIELD_DATE_RANGE_PRESET = 'dateRangePreset';

    public const string FIELD_START_DATE = 'startDate';

    public const string FIELD_END_DATE = 'endDate';

    public const string FIELD_STORE = 'store';

    public const string FIELD_LOCALE = 'locale';

    protected const string OPTION_STORE_CHOICES = 'store_choices';

    protected const string OPTION_LOCALE_CHOICES = 'locale_choices';

    protected const string RANGE_GROUP_DATE = 'google-analytics-date-range';

    protected const string CUSTOM_RANGE_FIELD_CLASS = 'js-google-analytics-date';

    public function buildForm(FormBuilderInterface $builder, array $options): void
    {
        $builder->setMethod('GET');

        $builder
            ->add(static::FIELD_DATE_RANGE_PRESET, ChoiceType::class, [
                'choices' => $options['preset_choices'],
                'data' => $options['default_preset'],
                'required' => false,
                'placeholder' => 'Custom range',
            ])
            ->add(static::FIELD_START_DATE, DatePickerType::class, [
                'required' => false,
                'range_group' => static::RANGE_GROUP_DATE,
                'range_role' => DatePickerType::RANGE_ROLE_START,
                'attr' => [
                    'class' => static::CUSTOM_RANGE_FIELD_CLASS,
                ],
            ])
            ->add(static::FIELD_END_DATE, DatePickerType::class, [
                'required' => false,
                'range_group' => static::RANGE_GROUP_DATE,
                'range_role' => DatePickerType::RANGE_ROLE_END,
                'attr' => [
                    'class' => static::CUSTOM_RANGE_FIELD_CLASS,
                ],
            ])
            ->add(static::FIELD_STORE, ChoiceType::class, [
                'choices' => $options[static::OPTION_STORE_CHOICES],
                'required' => false,
                'placeholder' => 'All stores',
            ])
            ->add(static::FIELD_LOCALE, ChoiceType::class, [
                'choices' => $options[static::OPTION_LOCALE_CHOICES],
                'required' => false,
                'placeholder' => 'All locales',
            ]);
    }

    public function configureOptions(OptionsResolver $resolver): void
    {
        $resolver->setDefaults([
            'csrf_protection' => false,
            'preset_choices' => [],
            'default_preset' => null,
            static::OPTION_STORE_CHOICES => [],
            static::OPTION_LOCALE_CHOICES => [],
        ]);
    }
}
